import { describe, expect, test } from 'vitest'
import { isStepComplete, type StepCompletionState } from './isStepComplete'

const base: StepCompletionState = {
  serviceType: null, selectedCoachPackage: null, currentRank: null, targetRank: null, winsPurchased: null,
  riotId: '', isMd5: false, riotVerified: false, riotLookupLoading: false, md5MatchesRemaining: null,
  clashTier: null, clashDay: null, customerLanes: [],
}

describe('isStepComplete', () => {
  test('blocks every step while a Riot lookup is loading', () => {
    expect(isStepComplete('service', { ...base, serviceType: 'elo_boost', riotLookupLoading: true })).toBe(false)
  })

  test('service step needs a service type', () => {
    expect(isStepComplete('service', base)).toBe(false)
    expect(isStepComplete('service', { ...base, serviceType: 'coaching' })).toBe(true)
  })

  test('coaching configure needs a package', () => {
    expect(isStepComplete('configure', { ...base, serviceType: 'coaching' })).toBe(false)
    expect(isStepComplete('configure', { ...base, serviceType: 'coaching', selectedCoachPackage: { id: 'p' } })).toBe(true)
  })

  test('elo_boost configure needs verified Riot account and ranks', () => {
    expect(isStepComplete('configure', { ...base, serviceType: 'elo_boost', riotVerified: true })).toBe(false)
  })

  test('win_boost rejects wins outside 1..5 or above md5 remaining', () => {
    const rank = { tier: 'GOLD', division: 'IV' } as unknown as StepCompletionState['currentRank']
    const ok = { ...base, serviceType: 'md5' as const, riotVerified: true, currentRank: rank, riotId: 'Nome#BR1', isMd5: true }
    expect(isStepComplete('configure', { ...ok, winsPurchased: 2, md5MatchesRemaining: 3 })).toBe(true)
    expect(isStepComplete('configure', { ...ok, winsPurchased: 4, md5MatchesRemaining: 3 })).toBe(false)
    expect(isStepComplete('configure', { ...ok, winsPurchased: 6, md5MatchesRemaining: null })).toBe(false)
  })

  test('later steps are always complete', () => {
    expect(isStepComplete('extras', base)).toBe(true)
  })
})
