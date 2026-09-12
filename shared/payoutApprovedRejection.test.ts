import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260912060000_allow_rejecting_approved_payout_request.sql'),
  'utf-8',
)

describe('admin_review_payout_request allows rejecting an approved request', () => {
  it('accepts approved as a source status when the target is rejected', () => {
    expect(sql).toContain("if v_req.status not in ('requested', 'under_review', 'approved') then")
  })

  it('keeps under_review/approved targets restricted to requested/under_review sources', () => {
    expect(sql).toContain("if v_req.status not in ('requested', 'under_review')\n       or (v_new = 'under_review' and v_req.status <> 'requested')")
  })

  it('still releases the ledger reservation on rejection', () => {
    expect(sql).toContain("'payout_release', v_req.amount,")
  })
})
