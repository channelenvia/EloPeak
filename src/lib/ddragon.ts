import { useQuery } from '@tanstack/react-query'

// Versão mais recente do Data Dragon (CDN pública de assets do LoL) -- usada
// só pra montar URLs de ícone (campeão, item, etc). Cacheada 24h (o patch
// não muda no meio do dia) e pega o item [0] do array, que a própria Riot
// documenta como o mais recente primeiro. Sem chave de API, sem custo.
export function useDdragonVersion() {
  const { data } = useQuery({
    queryKey: ['ddragon-version'],
    queryFn: async () => {
      const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      if (!res.ok) throw new Error('ddragon versions fetch failed')
      const versions = await res.json() as string[]
      return versions[0] ?? null
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })
  return data ?? null
}

export interface DdragonChampion {
  id: string
  name: string
}

type DdragonChampionCatalog = Record<string, DdragonChampion>
export type DdragonChampionIndex = Record<string, DdragonChampion>

export function normalizeChampionName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/g, '')
}

function editDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1)
      }
    }
  }

  return matrix[a.length][b.length]
}

function findChampion(champion: string, championIndex?: DdragonChampionIndex): DdragonChampion | undefined {
  if (!championIndex) return undefined
  const normalized = normalizeChampionName(champion)
  const exact = championIndex[normalized]
  if (exact || normalized.length < 3) return exact

  const maxDistance = normalized.length <= 4 ? 1 : normalized.length <= 8 ? 2 : 3
  const uniqueChampions = [...new Map(Object.values(championIndex).map(entry => [entry.id, entry])).values()]
  let best: DdragonChampion | undefined
  let bestDistance = maxDistance + 1
  let tied = false

  for (const candidate of uniqueChampions) {
    const candidateKeys = [normalizeChampionName(candidate.name), normalizeChampionName(candidate.id)]
    const distance = Math.min(...candidateKeys.map(key =>
      Math.abs(key.length - normalized.length) > maxDistance ? maxDistance + 1 : editDistance(normalized, key),
    ))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
      tied = false
    } else if (distance === bestDistance && candidate.id !== best?.id) {
      tied = true
    }
  }

  return bestDistance <= maxDistance && !tied ? best : undefined
}

// O catálogo transforma nomes livres digitados pelo booster no id exato que
// o CDN espera ("leesin"/"Lee Sin" -> "LeeSin", "Wukong" -> "MonkeyKing").
// Nome e id entram no índice sem espaços, acentos ou pontuação para também
// cobrir Cho'Gath, Kai'Sa, Nunu & Willump, Dr. Mundo etc.
export function useDdragonChampionIds(version: string | null) {
  const { data } = useQuery({
    queryKey: ['ddragon-champion-ids', version],
    queryFn: async () => {
      const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/pt_BR/champion.json`)
      if (!res.ok) throw new Error('ddragon champion catalog fetch failed')
      const payload = await res.json() as { data: DdragonChampionCatalog }

      return Object.values(payload.data).reduce<DdragonChampionIndex>((index, champion) => {
        index[normalizeChampionName(champion.id)] = champion
        index[normalizeChampionName(champion.name)] = champion
        return index
      }, {})
    },
    enabled: !!version,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })

  return data
}

export function resolveChampionName(champion: string, championIndex?: DdragonChampionIndex): string {
  return findChampion(champion, championIndex)?.name ?? champion.trim()
}

// Partidas da Riot já trazem o id canônico; campos livres de serviços usam o
// índice opcional para chegar a esse mesmo id antes de montar a URL.
export function championIconUrl(champion: string | null, version: string | null, championIndex?: DdragonChampionIndex): string | null {
  if (!champion || !version) return null
  const championId = findChampion(champion, championIndex)?.id ?? champion
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`
}
