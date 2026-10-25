import { describe, expect, it } from 'vitest'
import type { OrderStatusHistory } from '@/types'
import { autoCompleteAt, awaitingCustomerSince, formatTimeLeft } from './completionDeadline'

const row = (to_status: OrderStatusHistory['to_status'], created_at: string): OrderStatusHistory => ({
  id: created_at, order_id: 'o', from_status: null, to_status, changed_by: 'u', reason: null, created_at,
})

describe('completionDeadline', () => {
  it('usa a ULTIMA entrada em awaiting_customer (voltar a in_progress e entrar de novo reinicia o prazo)', () => {
    const since = awaitingCustomerSince([
      row('awaiting_customer', '2026-10-01T10:00:00Z'), row('in_progress', '2026-10-01T11:00:00Z'), row('awaiting_customer', '2026-10-02T09:00:00Z'),
    ])
    expect(since?.toISOString()).toBe('2026-10-02T09:00:00.000Z')
  })

  it('sem historico de awaiting_customer nao ha contagem', () => {
    expect(awaitingCustomerSince([row('in_progress', '2026-10-01T10:00:00Z')])).toBeNull()
    expect(awaitingCustomerSince(undefined)).toBeNull()
  })

  it('o prazo e de 12 h', () => {
    expect(autoCompleteAt(new Date('2026-10-02T09:00:00Z')).toISOString()).toBe('2026-10-02T21:00:00.000Z')
  })

  it('formata o tempo restante e some depois do prazo', () => {
    const deadline = new Date('2026-10-02T21:00:00Z')
    expect(formatTimeLeft(deadline, new Date('2026-10-02T09:40:00Z'))).toBe('11 h 20 min')
    expect(formatTimeLeft(deadline, new Date('2026-10-02T20:15:00Z'))).toBe('45 min')
    expect(formatTimeLeft(deadline, new Date('2026-10-02T20:59:40Z'))).toBe('menos de 1 min')
    expect(formatTimeLeft(deadline, new Date('2026-10-02T21:00:00Z'))).toBeNull()
  })
})
