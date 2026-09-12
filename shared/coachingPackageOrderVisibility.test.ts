import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// booster_services_read (migration 070) only let a caller see a row when
// they own it or it's active + the booster is approved. Deactivating/
// soft-deleting a coaching package (toggleCoachingPackageActive /
// deleteCoachingPackage) made it invisible to RLS for anyone but the owning
// booster -- the customer's (and admin's) order screen couldn't render the
// package title/description anymore, even though the order still references
// it via booster_service_id. Ver migration 20260912070000.
const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20260912070000_booster_services_visible_to_order_participants.sql'),
  'utf-8',
)

describe('booster_services_read policy', () => {
  it('grants access to the customer/booster of an order referencing the package', () => {
    expect(sql).toMatch(
      /exists \(\s*select 1 from public\.orders o\s*where o\.booster_service_id = booster_services\.id\s*and \(o\.customer_id = auth\.uid\(\) or o\.assigned_booster_id = auth\.uid\(\)\)/,
    )
  })

  it('grants admins access regardless of package status', () => {
    expect(sql).toContain('public.is_admin()')
  })

  it('keeps the existing owner and public-active clauses', () => {
    expect(sql).toContain('booster_id = auth.uid()')
    expect(sql).toContain('is_active and public.is_approved_booster(booster_id)')
  })
})
