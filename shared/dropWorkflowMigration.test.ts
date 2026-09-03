import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const migrationPath = join(
  root,
  'supabase/migrations/20260903150700_correct_drop_reassign_and_review.sql',
)
const sql = readFileSync(migrationPath, 'utf-8')

describe('drop/reassign corrective migration', () => {
  it('closes the previous assignment window before a reassignment opens another one', () => {
    expect(sql).toMatch(
      /update public\.order_booster_assignments\s+set unassigned_at = now\(\)[\s\S]*?and unassigned_at is null/i,
    )
  })

  it('reduces the gross order price by gross completed division value', () => {
    expect(sql).toContain(
      'v_order.total_price - (v_division_value_full * v_steps_crossed)',
    )
    expect(sql).not.toContain(
      'v_new_total_price := greatest(0, round(v_order.total_price - v_payout, 2));',
    )
  })

  it('uses the booster division share for every below-Master negative drop', () => {
    expect(sql).toContain(
      'v_win_value_unit := round(v_division_value_share / 4.0, 2);',
    )
    expect(sql).not.toMatch(
      /p_requester_role = 'booster' then v_division_value_full/i,
    )
  })

  it('persists the latest Master+ LP as the next assignment starting point', () => {
    expect(sql).toContain('v_new_current_pdl := v_latest_pdl;')
    expect(sql).toMatch(/current_pdl\s*= v_new_current_pdl/i)
  })

  it('directly assigns a pending-review order and only notifies the selected booster', () => {
    const fn = sql.match(
      /create or replace function public\.admin_assign_pending_review_order[\s\S]*?revoke all on function public\.admin_assign_pending_review_order/i,
    )?.[0]
    expect(fn).toBeTruthy()
    expect(fn).toMatch(/status = 'assigned'/i)
    expect(fn).toMatch(/assigned_booster_id = p_target_booster_id/i)
    expect(fn).toMatch(/values \(\s*p_target_booster_id, 'order_reassigned_by_admin'/i)
    expect(fn).not.toMatch(/from public\.profiles where role = 'admin'/i)
  })

  it('enforces reason, rate limit and the shared two-drop limit on both requesters', () => {
    for (const functionName of ['request_order_drop', 'request_customer_order_drop']) {
      const start = sql.indexOf(`create or replace function public.${functionName}`)
      const end = sql.indexOf(`revoke all on function public.${functionName}`, start)
      const fn = sql.slice(start, end)
      expect(start).toBeGreaterThan(-1)
      expect(fn).toContain('check_own_write_rate_limit')
      expect(fn).toContain('length(v_reason) < 10')
      expect(fn).toContain('coalesce(v_order.drop_count, 0) >= 2')
      expect(fn).toContain("status = 'drop_requested'")
    }
  })

  it('polls pending-review releases every ten seconds', () => {
    expect(sql).toMatch(
      /cron\.schedule\(\s*'release-pending-review-orders',\s*'10 seconds'/i,
    )
  })
})

describe('migration archive completeness', () => {
  const restoredMigrations = [
    '20260826120000_admin_drop_cancels_order_at_limit.sql',
    '20260828120000_restore_order_rpc_rate_limits.sql',
    '20260829010000_master_plus_pricing_rate_increase.sql',
    '20260829020000_admin_reassign_booster.sql',
    '20260829030000_booster_match_attribution_windows.sql',
    '20260829090000_remove_drop_warning_system_and_customer_sync_gate.sql',
    '20260829140000_negative_drop_repricing.sql',
    '20260830120000_flex_duo_master_plus_drop_repricing_fix.sql',
    '20260831140000_fix_negative_drop_win_boost_price_and_booster_fee.sql',
  ]

  it.each(restoredMigrations)('contains %s', (filename) => {
    expect(
      existsSync(join(root, 'supabase/migrations_archive', filename)),
    ).toBe(true)
  })

  it('contains the assignment-window table required by active migrations', () => {
    const assignmentMigration = readFileSync(
      join(
        root,
        'supabase/migrations_archive/20260829030000_booster_match_attribution_windows.sql',
      ),
      'utf-8',
    )
    expect(assignmentMigration).toMatch(
      /create table public\.order_booster_assignments/i,
    )
  })
})
