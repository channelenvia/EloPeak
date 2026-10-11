export interface ResumeDecisionInput {
  resumableOrderId: string | null | undefined
  pendingOrderId: string | null
  explicitlyStartingNewOrder: boolean
  hasCatalogEntryIntent: boolean
  dismissedOrderId: string | null
  // Rascunho local do configurador (sessionStorage): sem ele a Revisão nasce vazia (R$ 0,00, pagamento desabilitado).
  hasLocalDraft: boolean
}

// Decide se o configurador deve pular direto para a Revisão do pedido pendente do servidor (H-8).
export function shouldAutoResumePendingOrder(input: ResumeDecisionInput): boolean {
  if (!input.resumableOrderId) return false
  if (input.pendingOrderId || input.explicitlyStartingNewOrder || input.hasCatalogEntryIntent) return false
  if (input.resumableOrderId === input.dismissedOrderId) return false
  return input.hasLocalDraft
}

let isFirstMountInDocument = true

// ?new=1 reseta o rascunho quando o cliente CHEGA com a intencao de novo pedido; um F5/restauracao de aba com a
// URL ja em ?new=1 (que os CTAs do catalogo deixam la) nao pode apagar o que ele configurou (M-32). So a primeira
// montagem do documento pode ser um reload; navegacoes internas seguintes nunca sao.
export function consumeIsReloadMount(): boolean {
  const isFirst = isFirstMountInDocument
  isFirstMountInDocument = false
  if (!isFirst) return false
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return entry?.type === 'reload'
  } catch {
    return false
  }
}
