import { fetchWithTimeout } from './http.ts'

// Catalogo de campeoes (Data Dragon, pt_BR) usado pelo captcha de aceite. Cache em memoria por 6 h.
const DDRAGON = 'https://ddragon.leagueoflegends.com'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export interface Champion { id: string; name: string }
interface Catalog { fetchedAt: number; version: string; champions: Champion[] }

let cache: Catalog | null = null

// Mesma normalizacao do navegador (src/lib/ddragon.ts normalizeChampionName): sem acento, minusculas, so [a-z0-9].
export function normalizeChampionName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/g, '')
}

export async function getChampionCatalog(): Promise<Catalog> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache

  const versionsResp = await fetchWithTimeout(`${DDRAGON}/api/versions.json`, {}, 8000)
  if (!versionsResp.ok) throw new Error(`versions.json failed: ${versionsResp.status}`)
  const versions = await versionsResp.json() as unknown
  if (!Array.isArray(versions) || typeof versions[0] !== 'string') throw new Error('versions.json: unexpected shape')
  const version = versions[0]

  const champResp = await fetchWithTimeout(`${DDRAGON}/cdn/${version}/data/pt_BR/champion.json`, {}, 8000)
  if (!champResp.ok) throw new Error(`champion.json failed: ${champResp.status}`)
  const body = await champResp.json() as { data?: Record<string, { id?: string; name?: string }> }
  const champions = Object.values(body.data ?? {})
    .filter((c): c is Champion => typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({ id: c.id, name: c.name }))
  if (champions.length < 20) throw new Error('champion.json: catalogo incompleto')

  cache = { fetchedAt: Date.now(), version, champions }
  return cache
}

export function pickRandomChampion(champions: Champion[]): Champion {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return champions[buf[0] % champions.length]
}

export async function fetchChampionIcon(version: string, championId: string): Promise<Uint8Array> {
  const resp = await fetchWithTimeout(`${DDRAGON}/cdn/${version}/img/champion/${encodeURIComponent(championId)}.png`, {}, 8000)
  if (!resp.ok) throw new Error(`champion icon failed: ${resp.status}`)
  return new Uint8Array(await resp.arrayBuffer())
}
