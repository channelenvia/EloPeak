import { describe, expect, it } from 'vitest'
import {
  applyMasterPlusPdlDiscount, getMd5WinPrice, getWinBoostPrice, moneyToCents, RANK_TIER_ORDER,
  type QueueType,
} from './pricing'

const QUEUES: QueueType[] = ['solo_duo', 'flex']

describe('Duo nunca e mais barato que Solo (L-8)', () => {
  it.each(QUEUES)('MD5 na fila %s: duo >= solo em todo tier', (queue) => {
    for (const tier of RANK_TIER_ORDER) {
      expect(getMd5WinPrice(queue, tier, 'duo')).toBeGreaterThanOrEqual(getMd5WinPrice(queue, tier, 'solo'))
    }
  })

  it.each(QUEUES)('Vitoria avulsa na fila %s: duo >= solo em todo tier', (queue) => {
    for (const tier of RANK_TIER_ORDER) {
      expect(getWinBoostPrice(queue, tier, 'duo')).toBeGreaterThanOrEqual(getWinBoostPrice(queue, tier, 'solo'))
    }
  })

  it('MD5 duo GM/Challenger e proporcional ao solo pela razao do Master', () => {
    const ratio = getMd5WinPrice('solo_duo', 'master', 'duo') / getMd5WinPrice('solo_duo', 'master', 'solo')
    for (const tier of ['grandmaster', 'challenger'] as const) {
      const expected = getMd5WinPrice('solo_duo', tier, 'solo') * ratio
      expect(Math.abs(getMd5WinPrice('solo_duo', tier, 'duo') - expected)).toBeLessThan(0.02)
    }
  })
})

describe('desconto por PDL Master+ usa a vitoria da propria modalidade (L-6)', () => {
  it('Duo Flex Master com 200 PDL: 4 vitorias x 5% do valor Duo', () => {
    const base = 2150.9
    const winDuoCents = moneyToCents(getWinBoostPrice('flex', 'master', 'duo'))
    const discounted = applyMasterPlusPdlDiscount(base, 'grandmaster', 200, 'master', 'flex', undefined, 'duo')
    const solo = applyMasterPlusPdlDiscount(base, 'grandmaster', 200, 'master', 'flex')
    expect(discounted).toBeLessThan(solo)
    expect(moneyToCents(base) - moneyToCents(discounted)).toBe(Math.round(4 * 0.05 * winDuoCents))
  })
})
