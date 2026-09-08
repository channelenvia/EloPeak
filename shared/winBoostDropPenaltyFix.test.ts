import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(
  join(
    __dirname,
    '..',
    'supabase/migrations/20260908000000_fix_win_boost_drop_penalty_not_scaled_by_losses.sql',
  ),
  'utf-8',
)

describe('win_boost/md5 drop penalty scales with losses_played', () => {
  it('multiplies the penalty by losses_played instead of cutting a flat share of total_price', () => {
    expect(sql).toContain(
      "when p_requester_role = 'booster' then v_win_value_unit else round(v_win_value_unit * v_share_pct, 2) end)\n        * coalesce(v_order.losses_played, 0), 2);",
    )
    expect(sql).not.toMatch(
      /when p_requester_role = 'booster' then v_order\.total_price\s*\n\s*else round\(v_order\.total_price \* v_share_pct, 2\)/,
    )
  })

  it('keeps the payout formula for positive drops unchanged', () => {
    expect(sql).toContain(
      'v_payout := round(v_win_value_unit * v_share_pct * coalesce(v_order.wins_played, 0), 2);',
    )
  })
})
