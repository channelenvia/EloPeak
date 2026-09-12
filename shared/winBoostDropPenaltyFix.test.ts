import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  __dirname,
  '..',
  'supabase/migrations_archive/20260908000000_fix_win_boost_drop_penalty_not_scaled_by_losses.sql',
)
// migrations_archive/ fica fora do git (histórico local, ver .gitignore) --
// num clone novo/CI sem esse backup, este describe pula em vez de quebrar a
// suite inteira.
const migrationExists = existsSync(migrationPath)
const sql = migrationExists ? readFileSync(migrationPath, 'utf-8') : ''

describe.skipIf(!migrationExists)('win_boost/md5 drop penalty scales with losses_played', () => {
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
