import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// apply_order_drop releases the duo_accounts pool reservation on every drop,
// but never cleared orders.duo_own_riot_id (the Riot ID a booster enters when
// using their OWN duo account instead of the pool). Only admin_reassign_booster
// cleared it (in its own separate UPDATE after calling apply_order_drop) --
// a drop via admin_drop_order or resolve_drop_request left the old booster's
// Riot ID on the order, and accept_boost_order never touches the column, so
// the next booster inherited a stale identity. Ver
// supabase/migrations/20260912010000_...sql.
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260912010000_apply_order_drop_clears_duo_own_riot_id.sql'),
  'utf-8',
)

describe('apply_order_drop clears duo_own_riot_id on every drop path', () => {
  it('clears it in the over-drop-limit branch (status -> under_review)', () => {
    expect(sql).toMatch(/status\s+=\s+'under_review'[\s\S]*?duo_own_riot_id\s+=\s+null/)
  })

  it('clears it in the normal branch (status -> awaiting_assignment)', () => {
    expect(sql).toMatch(/status\s+=\s+'awaiting_assignment'[\s\S]*?duo_own_riot_id\s+=\s+null/)
  })
})
