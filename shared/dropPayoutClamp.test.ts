import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// apply_order_drop pagava o booster pelo progresso bruto sincronizado
// (wins_played / rank steps cruzados) sem travar no que foi CONTRATADO --
// partidas sincronizadas depois de drop_requested (o cron de sync continua
// rodando nesse status) podiam empurrar o payout acima do valor máximo
// possível do pedido. Ver supabase/migrations/20260911050000_...sql.
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260911050000_clamp_drop_payout_to_purchased_progress.sql'),
  'utf-8',
)

describe('apply_order_drop clamps payout to purchased progress', () => {
  it('win_boost/md5 payout never exceeds wins_purchased', () => {
    expect(sql).toContain(
      'v_payout := round(v_win_value_unit * v_share_pct * least(coalesce(v_order.wins_played, 0), coalesce(v_order.wins_purchased, 0)), 2);',
    )
  })

  it('standard elo_boost payout never crosses more divisions than remain on the order', () => {
    expect(sql).toContain('v_steps_crossed := least(v_divisions_remaining::integer, greatest(0,')
  })

  it('debits total_earnings on penalty, mirroring the payout credit', () => {
    expect(sql).toContain('update public.booster_profiles set total_earnings = total_earnings - v_penalty')
  })
})
