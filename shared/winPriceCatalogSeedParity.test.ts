import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getWinBoostPrice, moneyToCents, MASTER_PLUS_TIER_PRICE_CENTS, type QueueType, type RankTier } from './pricing'

// Seed idempotente dos catalogos de preco (W-4/M-12): public.win_price_cents_catalog espelha WIN_PRICE_CENTS a mao
// e master_plus_pricing espelha MASTER_PLUS_TIER_PRICE_CENTS (solo). Mudou preco, atualize os dois lados.
const migration = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261010070000_w4_payment_clash_catalog.sql'), 'utf8')

describe('win_price_cents_catalog (seed SQL) x getWinBoostPrice (TS)', () => {
  const rows = [...migration.matchAll(/\('(solo_duo|flex)', '(solo|duo)', '([a-z]+)', (\d+)\)/g)]
    .map(([, queue, mode, tier, cents]) => ({ queue: queue as QueueType, mode: mode as 'solo' | 'duo', tier: tier as RankTier, cents: Number(cents) }))

  it('seed cobre 10 tiers x solo/duo x 2 filas', () => {
    expect(rows).toHaveLength(40)
  })

  it('cada linha bate com a tabela TS', () => {
    for (const { queue, mode, tier, cents } of rows) {
      expect(moneyToCents(getWinBoostPrice(queue, tier, mode))).toBe(cents)
    }
  })
})

describe('master_plus_pricing (seed SQL, solo) x MASTER_PLUS_TIER_PRICE_CENTS (TS)', () => {
  const rows = [...migration.matchAll(/\('(master|grandmaster)', '(grandmaster|challenger)', '(solo_duo|flex)', 0, 'solo', ([\d.]+)\)/g)]
    .map(([, from, to, , price]) => ({ from, to, cents: Math.round(Number(price) * 100) }))

  it('master->gm, gm->challenger e master->challenger batem com a tabela TS', () => {
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const expected: Record<string, number> = {
      'master>grandmaster': MASTER_PLUS_TIER_PRICE_CENTS.master,
      'grandmaster>challenger': MASTER_PLUS_TIER_PRICE_CENTS.grandmaster,
      'master>challenger': MASTER_PLUS_TIER_PRICE_CENTS.challenger,
    }
    for (const { from, to, cents } of rows) expect(cents).toBe(expected[`${from}>${to}`])
  })
})
