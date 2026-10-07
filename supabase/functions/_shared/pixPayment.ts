export type ExistingPixPaymentAction = 'reuse' | 'already_paid' | 'blocked'

// Um pedido aceita um único mp_payment_id durante toda a vida. Portanto, um
// pagamento terminal não pode cair no fluxo de criação de outro PIX: o novo
// ID seria recusado por record_pix_payment e viraria uma cobrança órfã no MP.
export function classifyExistingPixPayment(status: unknown): ExistingPixPaymentAction {
  if (status === 'pending' || status === 'in_process' || status === 'authorized') {
    return 'reuse'
  }
  if (status === 'approved') return 'already_paid'
  return 'blocked'
}
