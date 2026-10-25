import { describe, expect, test } from 'vitest'
import { getAccountLockedMessage, hasDuoAccountHistory, shouldShowCountdown, shouldShowProgress } from './customerOrderRules'

const order = (o: Record<string, unknown>) => ({ assigned_booster_id: null, ...o }) as Parameters<typeof getAccountLockedMessage>[0]

describe('customerOrderRules', () => {
  test('progress includes disputed but not canceled', () => {
    expect(shouldShowProgress('disputed')).toBe(true)
    expect(shouldShowProgress('canceled')).toBe(false)
  })

  test('countdown excludes assigned', () => {
    expect(shouldShowCountdown('in_progress')).toBe(true)
    expect(shouldShowCountdown('assigned')).toBe(false)
  })

  test('duo history starts at in_progress', () => {
    expect(hasDuoAccountHistory('completed')).toBe(true)
    expect(hasDuoAccountHistory('assigned')).toBe(false)
  })

  test('locked message for awaiting payment', () => {
    expect(getAccountLockedMessage(order({ status: 'awaiting_payment', boost_mode: 'solo' }), undefined))
      .toMatch(/confirmação do pagamento/)
  })

  test('locked message after completion only for non duo', () => {
    expect(getAccountLockedMessage(order({ status: 'completed', boost_mode: 'solo' }), undefined)).toMatch(/indisponíveis/)
    expect(getAccountLockedMessage(order({ status: 'completed', boost_mode: 'duo' }), undefined)).toBeUndefined()
  })

  test('no access needed when state does not require credentials', () => {
    expect(getAccountLockedMessage(order({ status: 'in_progress', boost_mode: 'solo' }), { requires_credentials: false }))
      .toMatch(/não exige/)
    expect(getAccountLockedMessage(order({ status: 'in_progress', boost_mode: 'solo' }), { requires_credentials: true }))
      .toBeUndefined()
  })
})
