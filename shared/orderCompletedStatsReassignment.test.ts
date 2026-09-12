import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260912050000_credit_reassigned_booster_after_prior_completion.sql'),
  'utf-8',
)

describe('trg_fn_order_completed_booster_stats credits a reassigned booster', () => {
  it('scopes the idempotency guard to (order_id, booster_id) instead of order_id alone', () => {
    expect(sql).toContain(
      'where order_id = NEW.id and booster_id = NEW.assigned_booster_id',
    )
    expect(sql).not.toMatch(
      /not exists \(\s*select 1 from public\.payout_records\s*where order_id = NEW\.id\s*\)/,
    )
  })

  it('locks the booster row before reading is_top3, like apply_order_drop does', () => {
    expect(sql).toMatch(
      /from public\.booster_profiles\s*\n\s*where user_id = NEW\.assigned_booster_id\s*\n\s*for update;/,
    )
  })
})
