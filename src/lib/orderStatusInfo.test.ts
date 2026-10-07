import { describe, expect, it } from 'vitest'
import { describeOrderStatus, type OrderViewerRole } from './orderStatusInfo'
import type { OrderStatus } from '@/types'

const STATUSES: OrderStatus[] = [
  'draft', 'awaiting_payment', 'paid', 'pending_review', 'awaiting_assignment', 'assigned', 'in_progress',
  'paused', 'drop_requested', 'awaiting_customer', 'completed', 'disputed', 'under_review', 'refunded', 'canceled',
]
const ROLES: OrderViewerRole[] = ['customer', 'booster', 'admin']

describe('describeOrderStatus', () => {
  it.each(STATUSES)('descreve %s para todos os perfis, com texto útil', (status) => {
    for (const role of ROLES) {
      for (const assigned of [null, 'b1']) {
        const text = describeOrderStatus({ status, assigned_booster_id: assigned }, role)
        expect(text.length).toBeGreaterThan(15)
      }
    }
  })

  it('cliente com pagamento pendente é orientado a gerar o PIX; os demais veem o fato', () => {
    const order = { status: 'awaiting_payment', assigned_booster_id: null } as const
    expect(describeOrderStatus(order, 'customer')).toMatch(/PIX/)
    expect(describeOrderStatus(order, 'admin')).toMatch(/cliente ainda não pagou/i)
  })

  it('awaiting_customer sem booster pede credenciais; com booster pede ação no chat', () => {
    expect(describeOrderStatus({ status: 'awaiting_customer', assigned_booster_id: null }, 'customer')).toMatch(/credenciais/i)
    expect(describeOrderStatus({ status: 'awaiting_customer', assigned_booster_id: 'b1' }, 'customer')).toMatch(/chat/i)
  })

  it('prazo estourado vira aviso de atraso', () => {
    const started = new Date(Date.now() - 10 * 3600_000).toISOString()
    const text = describeOrderStatus({ status: 'in_progress', assigned_booster_id: 'b1', match_sync_started_at: started, estimated_hours: 2 }, 'customer')
    expect(text).toMatch(/prazo/i)
  })

  it('pedido concluído mostra a nota dada ou convida a avaliar', () => {
    const order = { status: 'completed', assigned_booster_id: 'b1' } as const
    expect(describeOrderStatus(order, 'customer', { reviewRating: 5 })).toMatch(/5\/5/)
    expect(describeOrderStatus(order, 'customer', { reviewRating: null })).toMatch(/avaliando/i)
  })
})
