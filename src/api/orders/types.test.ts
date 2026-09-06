// Regressão do bug relatado: pedido "aguardando pagamento" aparecendo como
// "Em andamento" pro admin -- orderListTabStatuses é a fonte única usada
// pelas 3 telas de pedidos (cliente/booster/admin), então testar aqui cobre
// as 3 de uma vez.
import { describe, expect, it } from 'vitest'
import { orderListTabStatuses } from './types'

describe('orderListTabStatuses', () => {
  it('não inclui awaiting_payment na aba "em andamento"', () => {
    expect(orderListTabStatuses('in_progress')).not.toContain('awaiting_payment')
  })

  it('agrupa aguardando pagamento e pendências de reembolso em "em análise"', () => {
    expect(orderListTabStatuses('em_analise')).toEqual(['awaiting_payment', 'under_review', 'disputed', 'refunded'])
  })

  it('"concluídos" não inclui cancelados por padrão', () => {
    expect(orderListTabStatuses('completed')).toEqual(['completed'])
  })

  it('o sub-filtro "Cancelados" inclui canceled junto de completed', () => {
    expect(orderListTabStatuses('completed', true)).toEqual(['completed', 'canceled'])
  })

  it('"todos" não tem lista de status própria (null = sem filtro além da exclusão padrão)', () => {
    expect(orderListTabStatuses('all')).toBeNull()
  })
})
