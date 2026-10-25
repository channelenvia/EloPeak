import { describe, expect, it } from 'vitest'
import { isCardPaymentInAnalysis, isPaymentConfirmed } from './orderPayment'

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

describe('isCardPaymentInAnalysis', () => {
  it('cartão com pagamento pendente está em análise', () => {
    expect(isCardPaymentInAnalysis({ method: 'credit_card', status: 'pending' })).toBe(true)
    expect(isCardPaymentInAnalysis({ method: 'debit_card', status: 'pending' })).toBe(true)
  })

  it('PIX pendente, cartão já decidido ou sem pagamento não é análise', () => {
    expect(isCardPaymentInAnalysis({ method: 'pix', status: 'pending' })).toBe(false)
    expect(isCardPaymentInAnalysis({ method: 'credit_card', status: 'paid' })).toBe(false)
    expect(isCardPaymentInAnalysis({ method: 'credit_card', status: 'failed' })).toBe(false)
    expect(isCardPaymentInAnalysis(null)).toBe(false)
  })
})
