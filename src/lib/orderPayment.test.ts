import { describe, expect, it } from 'vitest'
import { isPaymentConfirmed } from './orderPayment'

describe('isPaymentConfirmed', () => {
  it('confirmado quando o servidor já marca payment_confirmed', () => {
    expect(isPaymentConfirmed({ payment_confirmed: true, payment_status: 'paid' })).toBe(true)
  })

  it('pago durante a revisão do admin (pending_review): payment_confirmed false, payment_status paid', () => {
    expect(isPaymentConfirmed({ payment_confirmed: false, payment_status: 'paid' })).toBe(true)
  })

  it.each([
    [{ payment_confirmed: false, payment_status: 'pending' }],
    [{ payment_confirmed: false, payment_status: 'failed' }],
    [{ payment_confirmed: false, payment_status: 'refunded' }],
    [{ payment_confirmed: false, payment_status: null }],
    [{}],
    [null],
    [undefined],
  ])('não confirmado em %j', (state) => {
    expect(isPaymentConfirmed(state)).toBe(false)
  })
})
