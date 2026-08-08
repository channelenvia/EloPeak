import { describe, it, expect } from 'vitest'
import { displayNameCooldownDaysRemaining } from './displayNameCooldown'

describe('displayNameCooldownDaysRemaining', () => {
  it('is 0 when the name was never changed', () => {
    expect(displayNameCooldownDaysRemaining(null, new Date('2026-08-07T12:00:00Z'))).toBe(0)
  })

  it('is 0 once 30 days have fully passed', () => {
    expect(displayNameCooldownDaysRemaining('2026-07-01T12:00:00Z', new Date('2026-07-31T12:00:00Z'))).toBe(0)
  })

  it('counts down day by day since the last change', () => {
    const changedAt = '2026-08-01T12:00:00Z'
    expect(displayNameCooldownDaysRemaining(changedAt, new Date('2026-08-01T12:00:00Z'))).toBe(30)
    expect(displayNameCooldownDaysRemaining(changedAt, new Date('2026-08-07T12:00:00Z'))).toBe(24)
    expect(displayNameCooldownDaysRemaining(changedAt, new Date('2026-08-30T12:00:00Z'))).toBe(1)
  })
})
