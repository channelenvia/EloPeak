import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Clash is a once-per-account event, but nothing stopped a customer from
// having 2+ simultaneous Clash orders (the generic awaiting_payment cap in
// create-pix-payment only limits total pending orders across all services).
// Ver supabase/migrations/20260912020000_...sql.
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260912020000_cap_one_active_clash_order_per_customer.sql'),
  'utf-8',
)

describe('trg_cap_active_clash_orders blocks a second active Clash order per customer', () => {
  it('only checks when the new row is a clash order', () => {
    expect(sql).toContain("if new.service_type = 'clash' then")
  })

  it('treats every non-terminal status as blocking (only completed/canceled/refunded are exempt)', () => {
    expect(sql).toContain("status not in ('completed', 'canceled', 'refunded')")
  })

  it('serializes the check per customer via advisory lock, same pattern as trg_cap_pending_orders', () => {
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 2))')
  })
})
