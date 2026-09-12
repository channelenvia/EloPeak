import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// list_duo_accounts's booster branch quietly dropped the
// duo_account_rank_is_valid(current_rank) filter and the riot_id field in a
// past rewrite (migrations_archive/148) -- reserve_duo_account still rejects
// an out-of-range rank, so a booster could see an account in the picker that
// always fails with 'account_unavailable' when reserved. Ver
// supabase/migrations/20260912030000_...sql.
const sql = readFileSync(
  join(__dirname, '..', 'supabase/migrations/20260912030000_list_duo_accounts_restores_rank_filter.sql'),
  'utf-8',
)

describe('list_duo_accounts booster branch matches reserve_duo_account eligibility', () => {
  it('filters out accounts with an unsupported rank', () => {
    expect(sql).toMatch(/where is_active = true[\s\S]*?duo_account_rank_is_valid\(current_rank\)/)
  })

  it('returns riot_id, which BoosterVisibleDuoAccount / Accounts.tsx already expect', () => {
    expect(sql).toMatch(/'id', id, 'label', label, 'riot_id', riot_id/)
  })
})
