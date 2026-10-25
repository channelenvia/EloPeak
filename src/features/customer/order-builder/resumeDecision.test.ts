import { describe, it, expect } from 'vitest'
import { shouldAutoResumePendingOrder, type ResumeDecisionInput } from './resumeDecision'

const base: ResumeDecisionInput = {
  resumableOrderId: 'o1', pendingOrderId: null, explicitlyStartingNewOrder: false,
  hasCatalogEntryIntent: false, dismissedOrderId: null, hasLocalDraft: true,
}

describe('shouldAutoResumePendingOrder (H-8)', () => {
  it('retoma quando ha pedido pendente e rascunho local', () => {
    expect(shouldAutoResumePendingOrder(base)).toBe(true)
  })

  it('aba nova (sem rascunho local) nao cai numa Revisao vazia', () => {
    expect(shouldAutoResumePendingOrder({ ...base, hasLocalDraft: false })).toBe(false)
  })

  it('pedido dispensado por "Voltar"/"Sair e reiniciar" nao reabre sozinho', () => {
    expect(shouldAutoResumePendingOrder({ ...base, dismissedOrderId: 'o1' })).toBe(false)
  })

  it('?order=, ?new=1 e entrada pelo catalogo tem prioridade', () => {
    expect(shouldAutoResumePendingOrder({ ...base, pendingOrderId: 'o1' })).toBe(false)
    expect(shouldAutoResumePendingOrder({ ...base, explicitlyStartingNewOrder: true })).toBe(false)
    expect(shouldAutoResumePendingOrder({ ...base, hasCatalogEntryIntent: true })).toBe(false)
  })

  it('sem pedido pendente nao retoma', () => {
    expect(shouldAutoResumePendingOrder({ ...base, resumableOrderId: null })).toBe(false)
    expect(shouldAutoResumePendingOrder({ ...base, resumableOrderId: undefined })).toBe(false)
  })
})
