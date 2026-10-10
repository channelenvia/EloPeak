import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getEloDivPrice, moneyToCents, type QueueType, type RankTier } from './pricing'

// public.elo_div_price_cents espelha ELO_DIV_PRICE_CENTS* de shared/pricing.ts a mao:
// mudou preco, atualize os dois lados (e esta migration, via migration nova).
const migration = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261008030000_w3_progress_and_drops.sql'), 'utf8')

describe('elo_div_price_cents (SQL) x getEloDivPrice (TS)', () => {
  const rows = [...migration.matchAll(/\('(solo|duo)', '([a-z]+)', (\d+)\)/g)]
    .map(([, mode, tier, cents]) => ({ mode: mode as 'solo' | 'duo', tier: tier as RankTier, cents: Number(cents) }))

  it('seed cobre os 7 tiers para solo e duo', () => {
    expect(rows).toHaveLength(14)
  })

  it.each(['solo_duo', 'flex'] as QueueType[])('bate com a tabela TS na fila %s', (queue) => {
    for (const { mode, tier, cents } of rows) {
      expect(moneyToCents(getEloDivPrice(queue, tier, mode))).toBe(cents)
    }
  })
})
