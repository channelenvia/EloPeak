import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MASTER_PLUS_TIER_PRICE_CENTS, centsToMoney } from './pricing'

// Os percentuais/ordem "de verdade" dos addons vivem em service_extras
// (editável pelo admin), semeados por esta migration — não em código. Este
// teste é uma rede de segurança: garante que a seed inicial bate exatamente
// com os valores comerciais do enunciado (30/20/15/15, 30/30/15/15,
// 50/30/15/20) e que "priority" está sempre marcado como o último
// sort_order em cada fluxo. Não substitui testar contra um banco real —
// isso não foi possível neste ambiente (Docker/Supabase local indisponível,
// ver relatório final).
const migrationPath = join(__dirname, '..', 'supabase', 'migrations_archive', '005_boost_configurator.sql')
const sql = readFileSync(migrationPath, 'utf-8')

interface SeedRow {
  name: string
  pct: number
  sortOrder: number
  flow: string
  code: string
}

function parseSeedRows(source: string): SeedRow[] {
  // Cada linha de dado é ('Nome', 'descrição...', pct, sort_order, 'icon', 'flow', 'code'),
  // com a descrição podendo ter aspas/vírgulas — extraímos só os 4 campos finais
  // (pct, sort_order, flow, code) mais o nome, que são inequívocos.
  const rowRegex = /\('([^']+)',\s*'[^']*(?:''[^']*)*',\s*(\d+),\s*(\d+),\s*'[a-z-]+',\s*'(solo_standard|duo_standard|master_plus)',\s*'([a-z_]+)'\)/g
  const rows: SeedRow[] = []
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(source))) {
    rows.push({ name: match[1], pct: Number(match[2]), sortOrder: Number(match[3]), flow: match[4], code: match[5] })
  }
  return rows
}

const rows = parseSeedRows(sql)

describe('Seed de addons (005_boost_configurator.sql) — valores comerciais do enunciado', () => {
  it('a seed foi encontrada e parseada (12 linhas: 4 addons x 3 fluxos)', () => {
    expect(rows).toHaveLength(12)
  })

  function byFlow(flow: string) {
    return rows.filter(r => r.flow === flow).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  it('Solo Boost: Apenas Solo 30%, Mono Champ 20%, Transmissão ao Vivo 15%, Acesso Prioritário 15%', () => {
    const solo = byFlow('solo_standard')
    expect(solo.map(r => [r.name, r.pct])).toEqual([
      ['Apenas Solo', 30],
      ['Mono Champ', 20],
      ['Transmissão ao Vivo', 15],
      ['Acesso Prioritário', 15],
    ])
  })

  it('Duo Boost: Duo Indetectável 30%, Gameplay Explicativa 30%, Voice 15%, Acesso Prioritário 15%', () => {
    const duo = byFlow('duo_standard')
    expect(duo.map(r => [r.name, r.pct])).toEqual([
      ['Duo Indetectável', 30],
      ['Gameplay Explicativa', 30],
      ['Voice', 15],
      ['Acesso Prioritário', 15],
    ])
  })

  it('Master+: Gameplay Explicativa 50%, Mono Champ 30%, Transmissão ao Vivo 15%, Acesso Prioritário 20%', () => {
    const masterPlus = byFlow('master_plus')
    expect(masterPlus.map(r => [r.name, r.pct])).toEqual([
      ['Gameplay Explicativa', 50],
      ['Mono Champ', 30],
      ['Transmissão ao Vivo', 15],
      ['Acesso Prioritário', 20],
    ])
  })

  it('Acesso Prioritário é sempre sort_order 4 (último) nos 3 fluxos', () => {
    for (const flow of ['solo_standard', 'duo_standard', 'master_plus']) {
      const priority = rows.find(r => r.flow === flow && r.code === 'priority')
      const maxSortOrder = Math.max(...rows.filter(r => r.flow === flow).map(r => r.sortOrder))
      expect(priority?.sortOrder).toBe(maxSortOrder)
      expect(priority?.sortOrder).toBe(4)
    }
  })

  it('nenhum código se repete duas vezes dentro do mesmo fluxo', () => {
    for (const flow of ['solo_standard', 'duo_standard', 'master_plus']) {
      const codes = rows.filter(r => r.flow === flow).map(r => r.code)
      expect(new Set(codes).size).toBe(codes.length)
    }
  })
})

describe('Tabela master_plus_pricing — 12 combinações válidas, sem preço fictício', () => {
  it('semeia exatamente as 3 progressões válidas x 4 faixas de PDL, todas com price null', () => {
    const insertBlockMatch = sql.match(/insert into public\.master_plus_pricing[\s\S]*?on conflict/)
    expect(insertBlockMatch).not.toBeNull()
    const block = insertBlockMatch![0]
    const valueRows = block.match(/\('[a-z]+',\s*'[a-z]+',\s*'[a-z0-9_]+',\s*null\)/g) ?? []
    expect(valueRows).toHaveLength(12)
    // Nenhum valor numérico de preço na seed — confirma que nada foi inventado.
    expect(block).not.toMatch(/,\s*\d+(\.\d+)?\s*\)/)
  })
})

// A partir da migration 090 o preço do Master+ passou a depender do PAR
// (tier atual, tier alvo) -- não mais só do tier alvo (028-078, superseded).
// A migration 093 acrescentou fila e degrau de PDL; a 099 enxugou os degraus
// de PDL da SoloQ e tirou os da Flex por completo; a 146 (atual) reajustou
// todos os valores em +30%, mantendo a mesma estrutura de degraus. O preço
// EXIBIDO na página pública vem do código (MASTER_PLUS_TIER_PRICE_CENTS,
// chaveado pelo TIER ATUAL da linha exibida — "master" = custo de avançar de
// Mestre pra Grão-Mestre, "grandmaster" = custo de avançar de Grão-Mestre pra
// Challenger) enquanto o preço COBRADO vem da tabela master_plus_pricing no
// banco (lida em StepConfigure e revalidada em orderPricing.ts), sempre no
// PRIMEIRO degrau de PDL (menor pdl_from) da fila solo_duo -- mesma
// referência que a página pública usa (PDL=0 de quem acabou de entrar no
// tier atual). São duas fontes de verdade pro mesmo valor monetário: se
// divergirem, o cliente vê um preço e é cobrado outro. Este teste amarra a
// seed da migration 146 (estado FINAL do banco) ao constante do código.
describe('master_plus_pricing (146) — seed do banco bate com o preço exibido na página pública', () => {
  const migration146 = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations_archive', '146_master_plus_pricing_30pct_increase.sql'),
    'utf-8',
  )

  function parseFirstBracketPrices(source: string): Record<string, number> {
    const insertBlock = source.match(/insert into public\.master_plus_pricing[\s\S]*?;/)
    expect(insertBlock).not.toBeNull()
    const rowRegex = /\('([a-z]+)',\s*'([a-z]+)',\s*'([a-z_]+)',\s*(\d+),\s*(\d+\.\d+)\)/g
    const lowestPdlFrom: Record<string, number> = {}
    const out: Record<string, number> = {}
    let match: RegExpExecArray | null
    while ((match = rowRegex.exec(insertBlock![0]))) {
      const [, currentTier, targetTier, queueType, pdlFromStr, priceStr] = match
      if (queueType !== 'solo_duo') continue
      const key = `${currentTier}->${targetTier}`
      const pdlFrom = Number(pdlFromStr)
      if (!(key in lowestPdlFrom) || pdlFrom < lowestPdlFrom[key]) {
        lowestPdlFrom[key] = pdlFrom
        out[key] = Number(priceStr)
      }
    }
    return out
  }

  const seeded = parseFirstBracketPrices(migration146)

  it('semeia o primeiro degrau (solo_duo) dos 3 pares válidos (master->grandmaster, grandmaster->challenger, master->challenger)', () => {
    expect(Object.keys(seeded).sort()).toEqual(['grandmaster->challenger', 'master->challenger', 'master->grandmaster'])
  })

  it('preço cobrado (banco, primeiro degrau) para master->grandmaster == preço exibido (código) para "master" (avançar de Mestre)', () => {
    expect(seeded['master->grandmaster']).toBe(centsToMoney(MASTER_PLUS_TIER_PRICE_CENTS.master))
  })

  it('preço cobrado (banco, primeiro degrau) para grandmaster->challenger == preço exibido (código) para "grandmaster" (avançar de Grão-Mestre)', () => {
    expect(seeded['grandmaster->challenger']).toBe(centsToMoney(MASTER_PLUS_TIER_PRICE_CENTS.grandmaster))
  })

  it('preço cobrado (banco, primeiro degrau) para master->challenger == preço exibido (código) para challenger (rota direta)', () => {
    expect(seeded['master->challenger']).toBe(centsToMoney(MASTER_PLUS_TIER_PRICE_CENTS.challenger))
  })
})
