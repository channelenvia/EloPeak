import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// sessions_purchased is never actually set by the purchase flow (no caller
// of orderBuilderStore.setSessionsPurchased exists -- StepPayment always
// forwards the initial `null`, see migration 20260908090000's comment).
// That's harmless ONLY as long as nothing on the pricing/validation path
// requires it or divides by it for coaching -- this pins that invariant so a
// future change (e.g. per-session pricing) can't silently assume the column
// is populated for every existing/new coaching order.
const src = readFileSync(join(__dirname, '..', 'supabase', 'functions', '_shared', 'orderPricing.ts'), 'utf-8')

describe('coaching sessions_purchased stays optional', () => {
  it('is nullable in the intake schema, not required like wins_purchased is for win_boost', () => {
    expect(src).toMatch(/sessions_purchased:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(20\)\.nullable\(\)/)
  })

  it('coaching validation never requires it (only booster_service_id is mandatory)', () => {
    const coachingBlock = src.match(/if \(other\.service_type === 'coaching'\) \{[\s\S]*?\n {2}\}/)
    expect(coachingBlock).not.toBeNull()
    expect(coachingBlock![0]).not.toMatch(/sessions_purchased/)
  })

  it('coaching price is read from the booster_services package, never derived from sessions_purchased', () => {
    const pricingBlock = src.match(/if \(normalized\.serviceType === 'coaching'\) \{[\s\S]*?coachPackagePrice = Number\(coachPackage\.price\)/)
    expect(pricingBlock).not.toBeNull()
    expect(pricingBlock![0]).not.toMatch(/sessionsPurchased/)
  })
})
