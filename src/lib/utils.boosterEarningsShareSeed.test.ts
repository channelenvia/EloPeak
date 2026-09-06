import { describe, expect, it } from 'vitest'
import { boosterEarningsShare, BOOSTER_EARNINGS_SHARE_COACHING, BOOSTER_EARNINGS_SHARE_NORMAL, BOOSTER_EARNINGS_SHARE_TOP3 } from './utils'

// BOOSTER_EARNINGS_SHARE_NORMAL/TOP3/COACHING espelham à mão a comissão da
// plataforma cobrada por trg_fn_order_completed_booster_stats (trigger de
// conclusão de pedido) -- share do booster = 1 - comissão. Diferente de
// WIN_PRICE_CENTS/master_plus_pricing (que têm uma migration única e atual
// pra parsear, ver winPriceCentsSeed.test.ts/boostConfigSeed.test.ts), este
// trigger foi definido/alterado em múltiplas migrations arquivadas sem uma
// versão única e confiável em supabase/migrations/ pra parsear -- os valores
// abaixo foram confirmados direto contra pg_get_functiondef('public.
// trg_fn_order_completed_booster_stats') no banco vivo em 2026-09-06:
//   v_commission_rate := case
//     when service_type = 'coaching' then 0.30
//     when is_top3 then 0.40
//     else 0.45
//   end
// share do booster = 1 - v_commission_rate. Se este teste falhar, reconfira
// ao vivo (pg_get_functiondef) antes de assumir que é a constante TS que
// está errada -- pode ser o trigger que mudou.
describe('BOOSTER_EARNINGS_SHARE_* — bate com trg_fn_order_completed_booster_stats (confirmado ao vivo em 2026-09-06)', () => {
  const LIVE_COMMISSION_RATE = { normal: 0.45, top3: 0.40, coaching: 0.30 }

  it('normal: share = 1 - 45% de comissão', () => {
    expect(BOOSTER_EARNINGS_SHARE_NORMAL).toBeCloseTo(1 - LIVE_COMMISSION_RATE.normal, 10)
  })

  it('top3: share = 1 - 40% de comissão', () => {
    expect(BOOSTER_EARNINGS_SHARE_TOP3).toBeCloseTo(1 - LIVE_COMMISSION_RATE.top3, 10)
  })

  it('coaching: share = 1 - 30% de comissão, fixo independente de is_top3', () => {
    expect(BOOSTER_EARNINGS_SHARE_COACHING).toBeCloseTo(1 - LIVE_COMMISSION_RATE.coaching, 10)
    expect(boosterEarningsShare(true, 'coaching')).toBe(BOOSTER_EARNINGS_SHARE_COACHING)
    expect(boosterEarningsShare(false, 'coaching')).toBe(BOOSTER_EARNINGS_SHARE_COACHING)
  })

  it('boosterEarningsShare() resolve top3/normal corretamente pra serviços não-coaching', () => {
    expect(boosterEarningsShare(true, 'elo_boost')).toBe(BOOSTER_EARNINGS_SHARE_TOP3)
    expect(boosterEarningsShare(false, 'elo_boost')).toBe(BOOSTER_EARNINGS_SHARE_NORMAL)
  })
})
