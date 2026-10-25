import { describe, expect, test } from 'vitest'
import { getSummaryTotals, getVisibleWinPackage, getWinPackagePrice, resolveBuilderFlow } from './orderSummaryMath'

describe('orderSummaryMath', () => {
  test('flow is null without a service and standard for clash', () => {
    expect(resolveBuilderFlow(null, null, 'solo', 'solo_duo')).toBeNull()
    expect(resolveBuilderFlow('clash', null, 'duo', 'solo_duo')).toBe('duo_standard')
    expect(resolveBuilderFlow('md5', null, 'solo', 'solo_duo')).toBe('solo_standard')
    expect(resolveBuilderFlow('elo_boost', null, 'solo', 'solo_duo')).toBeNull()
  })

  test('win package is hidden when none selected', () => {
    expect(getVisibleWinPackage(null, 'solo_standard')).toBeNull()
  })

  test('win package price is zero without package or rank', () => {
    const input = { winPackage: null, flow: 'solo_standard' as const, currentRank: null, queueType: 'solo_duo' as const, boostMode: 'solo' as const }
    expect(getWinPackagePrice(null, input)).toBe(0)
    expect(getWinPackagePrice(3, input)).toBe(0)
  })

  test('totals without coupon equal subtotal', () => {
    const t = getSummaryTotals(100, 20, null, 'elo_boost')
    expect(t).toMatchObject({ subtotal: 120, discountPrice: 0, totalPrice: 120, coupon: null })
  })

  test('totals never exceed subtotal with a coupon', () => {
    const t = getSummaryTotals(100, 0, 'ANYCODE', 'coaching')
    expect(t.totalPrice).toBeLessThanOrEqual(100)
    expect(t.totalPrice).toBe(t.subtotal - t.discountPrice)
  })
})
