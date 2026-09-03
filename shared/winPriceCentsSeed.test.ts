import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getWinBoostPrice, moneyToCents } from './pricing'
import type { QueueType } from './pricing'

// win_price_cents_catalog (migration 20260903150000) espelha WIN_PRICE_CENTS
// (const privada em pricing.ts) pro Postgres poder calcular o "valor de 1
// win no elo atual" nas fórmulas de drop/reatribuição do Mestre+ -- mesma
// necessidade e mesmo risco de divergência silenciosa que master_plus_pricing
// (ver boostConfigSeed.test.ts). Compara a seed da migration contra a função
// pública getWinBoostPrice() em vez de importar a const privada -- garante
// que o valor cobrado do banco bate com o que a API pública do módulo
// realmente devolve.
describe('win_price_cents_catalog (20260903150000) — seed do banco bate com WIN_PRICE_CENTS', () => {
  const migration = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260903150000_win_price_cents_mirror.sql'),
    'utf-8',
  )

  function parseSeed(source: string): { queue: QueueType; mode: 'solo' | 'duo'; tier: string; cents: number }[] {
    const insertBlock = source.match(/insert into public\.win_price_cents_catalog[\s\S]*?;/)
    expect(insertBlock).not.toBeNull()
    const rowRegex = /\('([a-z_]+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(\d+)\)/g
    const out: { queue: QueueType; mode: 'solo' | 'duo'; tier: string; cents: number }[] = []
    let match: RegExpExecArray | null
    while ((match = rowRegex.exec(insertBlock![0]))) {
      const [, queue, mode, tier, centsStr] = match
      out.push({ queue: queue as QueueType, mode: mode as 'solo' | 'duo', tier, cents: Number(centsStr) })
    }
    return out
  }

  const seeded = parseSeed(migration)
  const TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger']

  it('semeia os 10 tiers para as 2 filas x 2 modos (40 linhas)', () => {
    expect(seeded).toHaveLength(40)
  })

  it.each(seeded)('$queue/$mode/$tier: preço semeado bate com getWinBoostPrice()', ({ queue, mode, tier, cents }) => {
    expect(cents).toBe(moneyToCents(getWinBoostPrice(queue, tier as never, mode)))
  })

  it('cobre todos os 10 tiers em cada combinação de fila/modo', () => {
    for (const queue of ['solo_duo', 'flex'] as const) {
      for (const mode of ['solo', 'duo'] as const) {
        const tiers = seeded.filter((s) => s.queue === queue && s.mode === mode).map((s) => s.tier).sort()
        expect(tiers).toEqual([...TIERS].sort())
      }
    }
  })
})
