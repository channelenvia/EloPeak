import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getWinBoostPrice, moneyToCents } from './pricing'
import type { QueueType, RankTier } from '../src/types'

// Paridade TS x Postgres do preco de vitoria (win_price_cents_catalog espelha shared/pricing.ts a mao).
// Le o banco ALVO (somente SELECT, chave anon): so roda quando PARITY_SUPABASE_URL e PARITY_SUPABASE_ANON_KEY existem.
//   PARITY_SUPABASE_URL=... PARITY_SUPABASE_ANON_KEY=... npx vitest run shared/pricingParity.test.ts
const url = process.env.PARITY_SUPABASE_URL
const anonKey = process.env.PARITY_SUPABASE_ANON_KEY

describe.skipIf(!url || !anonKey)('paridade de preco TS x Postgres', () => {
  it('win_price_cents_catalog bate com getWinBoostPrice (todas as linhas)', async () => {
    const client = createClient(url!, anonKey!)
    const { data, error } = await client.from('win_price_cents_catalog').select('queue_type, boost_mode, tier, price_cents')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThan(0)

    const mismatches = (data ?? []).filter((row) =>
      moneyToCents(getWinBoostPrice(row.queue_type as QueueType, row.tier as RankTier, row.boost_mode as 'solo' | 'duo')) !== Number(row.price_cents))
    expect(mismatches).toEqual([])
  })
})
