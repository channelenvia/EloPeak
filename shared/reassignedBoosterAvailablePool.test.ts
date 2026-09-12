import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// admin_reassign_booster de volta pro mesmo booster que já dropou o pedido
// (preferred_booster_id = booster) fazia o RPC ter sucesso, mas o pedido
// nunca aparecia na aba Jobs -- available_boost_orders escondia a linha
// incondicionalmente pra quem já tinha um order_drop_requests aprovado nela,
// sem a mesma exceção que accept_boost_order já tinha (20260911000000).
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260911040000_reassigned_booster_sees_order_in_available_pool.sql'),
  'utf-8',
)

describe('available_boost_orders shows admin-reassigned orders back to the booster who dropped them', () => {
  it('bypasses the approved-drop-request guard when the order is reserved for this booster', () => {
    expect(sql).toMatch(
      /preferred_booster_id = auth\.uid\(\)\s*\n\s*or not exists \(\s*\n\s*select 1 from public\.order_drop_requests dr/,
    )
  })

  it('still hides the row for everyone else who previously dropped it', () => {
    expect(sql).toContain("dr.booster_id = auth.uid() and dr.status = 'approved'")
  })
})
