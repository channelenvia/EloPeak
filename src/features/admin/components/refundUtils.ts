import type { Refund } from '@/types'

export const REFUND_STATUS_LABEL: Record<Refund['status'], string> = {
  pending: 'A reembolsar',
  succeeded: 'Reembolsado',
  failed: 'Falhou',
}

// Marcação manual desfeita pelo admin não é uma falha do provedor.
export function refundStatusLabel(refund: Refund): string {
  return refund.is_manual && refund.status === 'failed' ? 'Desfeito' : REFUND_STATUS_LABEL[refund.status]
}

export const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function refundStatusTone(status: Refund['status']): string {
  if (status === 'succeeded') return 'text-success bg-success/10'
  if (status === 'failed') return 'text-danger bg-danger/10'
  return 'text-warning bg-warning/10'
}

export function matchesRefundSearch(refund: Refund, search: string): boolean {
  const term = search.trim().toLowerCase()
  return !term || refund.order_id.toLowerCase().includes(term)
}
