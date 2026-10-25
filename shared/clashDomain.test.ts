// shared/clashDomain.test.ts
import { describe, it, expect } from 'vitest'
import { CLASH_TIER_RANK_TIERS, CLASH_TIER_BOUNDARY_RANKS } from './clashDomain'

describe('CLASH_TIER_RANK_TIERS / CLASH_TIER_BOUNDARY_RANKS', () => {
  it('cobre os 10 RankTier exatamente uma vez, em ordem crescente por tier', () => {
    const all = [
      ...CLASH_TIER_RANK_TIERS.tier_4,
      ...CLASH_TIER_RANK_TIERS.tier_3,
      ...CLASH_TIER_RANK_TIERS.tier_2,
      ...CLASH_TIER_RANK_TIERS.tier_1,
    ]
    expect(all).toEqual([
      'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger',
    ])
  })

  it('boundary ranks batem com o primeiro/último de cada tier', () => {
    for (const tier of ['tier_4', 'tier_3', 'tier_2', 'tier_1'] as const) {
      const ranks = CLASH_TIER_RANK_TIERS[tier]
      expect(CLASH_TIER_BOUNDARY_RANKS[tier].low).toBe(ranks[0])
      expect(CLASH_TIER_BOUNDARY_RANKS[tier].high).toBe(ranks[ranks.length - 1])
    }
  })
})
