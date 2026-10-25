import { getOrderStatusGroup } from '@/lib/utils'
import type { Order } from '@/types'

// Status que exibem a barra de progresso. Deliberadamente NÃO usa
// getOrderStatusGroup: inclui 'disputed' de propósito (o grupo o classifica
// como 'hidden' junto com canceled/refunded).
const PROGRESS_STATUSES: readonly string[] = [
  'awaiting_payment', 'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused',
  'drop_requested', 'awaiting_customer', 'completed', 'disputed',
]

export function shouldShowProgress(status: string): boolean {
  return PROGRESS_STATUSES.includes(status)
}

// Status em que o contador de entrega faz sentido (match_sync_started_at só
// existe a partir de in_progress; 'assigned' fica de fora de propósito).
const COUNTDOWN_STATUSES: readonly string[] = ['in_progress', 'paused', 'awaiting_customer']

export function shouldShowCountdown(status: string): boolean {
  return COUNTDOWN_STATUSES.includes(status)
}

// Histórico duo só existe depois que a sincronização começou (in_progress em diante).
const DUO_HISTORY_STATUSES: readonly string[] = ['in_progress', 'paused', 'awaiting_customer', 'completed']

export function hasDuoAccountHistory(status: string): boolean {
  return DUO_HISTORY_STATUSES.includes(status)
}

export function getAccountLockedMessage(
  order: Pick<Order, 'status' | 'boost_mode' | 'assigned_booster_id'>,
  customerState: { requires_credentials?: boolean } | null | undefined,
): string | undefined {
  if (order.status === 'awaiting_payment') return 'A conta do pedido fica disponível após a confirmação do pagamento.'
  if (order.status === 'completed' && order.boost_mode !== 'duo') return 'As credenciais ficam indisponíveis após a conclusão do pedido.'
  if (order.boost_mode === 'duo' && getOrderStatusGroup(order) === 'awaiting_booster') {
    return 'A conta Duo fica disponível quando um booster aceitar o pedido.'
  }
  if (customerState && !customerState.requires_credentials && order.boost_mode !== 'duo') return 'Este serviço não exige acesso à conta.'
  return undefined
}
