import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// admin_override_order_status travava a linha (for update) mas nunca
// reconferia o status atual antes de escrever -- ver
// supabase/migrations/20260911060000_...sql.
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260911060000_admin_override_status_guards_transition.sql'),
  'utf-8',
)

describe('admin_override_order_status rejects a no-op transition', () => {
  it('checks the current status against the target before writing', () => {
    expect(sql).toContain("if v_order.status::text = p_new_status then")
    expect(sql).toContain("return jsonb_build_object('success', false, 'error', 'no_status_change');")
  })
})
