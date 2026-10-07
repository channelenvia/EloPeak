import type { CustomerOrderState } from '@/api/orders/types'

// get_customer_order_state.payment_confirmed só vale para pedidos já liberados
// (awaiting_assignment em diante) e fica false durante 'pending_review' -- a
// janela de revisão do admin depois do pagamento --, embora o pagamento já
// esteja pago. payment_status === 'paid' cobre essa janela também.
// Cartão já enviado ao Mercado Pago e ainda em análise (antifraude/emissor).
export function isCardPaymentInAnalysis(info: { method: string; status: string } | null | undefined): boolean {
  return !!info && info.method !== 'pix' && info.status === 'pending'
}

export function isPaymentConfirmed(state: Pick<CustomerOrderState, 'payment_confirmed' | 'payment_status'> | null | undefined): boolean {
  return !!state && (state.payment_confirmed === true || state.payment_status === 'paid')
}
