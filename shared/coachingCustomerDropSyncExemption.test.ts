import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// request_order_drop e admin_reassign_booster já foram isentos da guarda de
// last_match_synced_at pra coaching (coaching nunca sincroniza partida --
// sem riot_id, ver orderPricing.ts). request_customer_order_drop tinha a
// MESMA guarda e ficou de fora dessa correção -- um cliente nunca conseguia
// pedir drop do próprio pedido de coaching em andamento, travado esperando
// um sync que nunca acontece. Ver migration 20260912080000.
const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20260912080000_customer_drop_request_coaching_sync_exemption.sql'),
  'utf-8',
)

describe('request_customer_order_drop coaching sync exemption', () => {
  it('exempts coaching from the last_match_synced_at guard', () => {
    expect(sql).toMatch(
      /v_order\.status = 'in_progress' and v_order\.service_type <> 'coaching' and v_order\.last_match_synced_at is null/,
    )
  })

  it('still keeps the guard for every other service type', () => {
    expect(sql).toContain("'sync_required_before_drop'")
  })

  it('keeps the customer-only authorization and drop-limit checks', () => {
    expect(sql).toContain('auth.uid() is distinct from v_order.customer_id')
    expect(sql).toContain('coalesce(v_order.drop_count, 0) >= 2')
  })
})
