import { describe, it, expect, vi } from 'vitest'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import {
  buildWaitingState, fallbackOrderIdOf, isDeadOrderError, orderDetailPath, resolveFlow, withRetriedQr,
  type PaymentStore, type PixState,
} from './paymentTypes'
import { buildOrderIntent } from './buildOrderIntent'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const storeOf = (over: Partial<PaymentStore>) => ({
  serviceType: 'coaching', gameId: 'g', serviceId: 's', server: 'br', customerNotes: '', couponCode: null,
  boostMode: 'solo', queueType: 'solo_duo', currentRank: null, targetRank: null, winsPurchased: 0,
  sessionsPurchased: 0, winPackage: null, selectedCoachPackage: null, riotId: 'x#1', customerLanes: ['top'],
  rankDeclared: true, currentLp: 0, currentPdl: 0, clashTier: null, clashDay: null,
  ...over,
}) as unknown as PaymentStore

describe('paymentTypes', () => {
  it('orderDetailPath adiciona #credentials só quando exigido', () => {
    expect(orderDetailPath('a', false)).toBe('/orders/a')
    expect(orderDetailPath('a', true)).toBe('/orders/a#credentials')
  })

  it('withRetriedQr só atualiza o mesmo pedido em espera', () => {
    const waiting = buildWaitingState({ order_id: 'o', total_price: 10, payment_id: 1, expires_at: 'e' }, 'o', 'code')
    expect(withRetriedQr(waiting, 'o', 'IMG')).toMatchObject({ qr_base64: 'IMG' })
    expect(withRetriedQr(waiting, 'other', 'IMG')).toBe(waiting)
    const idle: PixState = { phase: 'idle' }
    expect(withRetriedQr(idle, 'o', 'IMG')).toBe(idle)
  })

  it('isDeadOrderError reconhece 404 e 400 "not awaiting payment"', () => {
    const err = (status: number, message: string) => new EdgeFunctionError({ status, message, body: null })
    expect(isDeadOrderError(err(404, 'x'))).toBe(true)
    expect(isDeadOrderError(err(400, 'Order Not Awaiting Payment'))).toBe(true)
    expect(isDeadOrderError(err(400, 'other'))).toBe(false)
    expect(isDeadOrderError(new Error('x'))).toBe(false)
  })

  it('fallbackOrderIdOf ignora erros comuns', () => {
    expect(fallbackOrderIdOf(new Error('x'))).toBeUndefined()
    const withBody = new EdgeFunctionError({ status: 500, message: 'm', body: { order_id: 'o1' } as never })
    expect(fallbackOrderIdOf(withBody)).toBe('o1')
  })

  it('resolveFlow usa o fluxo padrão para win_boost/md5/clash e null para coaching', () => {
    expect(resolveFlow(storeOf({ serviceType: 'clash', boostMode: 'duo' }))).toBe('duo_standard')
    expect(resolveFlow(storeOf({ serviceType: 'md5' }))).toBe('solo_standard')
    expect(resolveFlow(storeOf({ serviceType: 'coaching' }))).toBeNull()
  })
})

describe('buildOrderIntent', () => {
  it('coaching manda lanes vazias e rank_declared false', () => {
    const intent = buildOrderIntent(storeOf({}), [], null)
    expect(intent).toMatchObject({ customer_lanes: [], rank_declared: false, riot_id: null, addon_codes: [] })
  })

  it('clash não envia queue_type', () => {
    const intent = buildOrderIntent(storeOf({ serviceType: 'clash' }), ['a'], 'solo_standard')
    expect(intent).not.toHaveProperty('queue_type')
    expect(intent).toMatchObject({ addon_codes: ['a'], customer_lanes: ['top'] })
  })

  it('elo_boost master_plus usa current_pdl; demais usam current_lp e win_package', () => {
    const master = buildOrderIntent(storeOf({ serviceType: 'elo_boost', currentPdl: 7 }), [], 'master_plus')
    expect(master).toMatchObject({ current_pdl: 7 })
    expect(master).not.toHaveProperty('win_package')
    const other = buildOrderIntent(storeOf({ serviceType: 'elo_boost', currentLp: 3 }), [], 'solo_standard')
    expect(other).toMatchObject({ current_lp: 3 })
    expect(other).toHaveProperty('win_package')
  })
})
