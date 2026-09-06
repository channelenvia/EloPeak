import type {
  BoosterDuoMatch, Order, OrderCoachingTopic, OrderDropRequest, OrderMatch, OrderRankVerification, OrderStatus, OrderStatusHistory, Payment,
} from '@/types'

export type { BoosterDuoMatch, Order, OrderCoachingTopic, OrderDropRequest, OrderMatch, OrderRankVerification, OrderStatusHistory, Payment }

export interface DuoAccountHistoryEntry {
  riot_id: string
  /** true = orders.duo_own_riot_id (conta própria do booster, sem timestamp de quando foi setada -- tratada como a entrada mais recente). false = reserva de conta do pool, com reserved_at/released_at reais. */
  own_account: boolean
  reserved_at: string | null
  released_at: string | null
}

export interface CustomerOrderState {
  success: boolean
  error?: string
  order_id: string | null
  status?: OrderStatus
  payment_status?: string | null
  can_pay?: boolean
  payment_confirmed?: boolean
  requires_credentials?: boolean
  credentials_set?: boolean
  can_submit_credentials?: boolean
  can_confirm_completion?: boolean
}

export interface SlotInfo {
  solo_count?: number
  duo_count?: number
  total_count?: number
  max_total?: number
  is_top3?: boolean
  exclusive_slot_used?: boolean
  max_exclusive?: number
}

export interface PixPaymentResponse {
  success?: boolean
  order_id: string
  total_price: number
  payment_id: string | number
  status?: string
  qr_code?: string
  qr_code_base64?: string | null
  expires_at: string
  reused?: boolean
  saved?: boolean
}

export type OrderIntent = Record<string, unknown>

export interface BoosterOrdersPage {
  orders: Order[]
  nextOffset?: number
}

// Fonte única de abas de status, compartilhada pelos 3 papéis (cliente,
// booster, admin) -- cada query ainda escopa por dono (customer_id/
// assigned_booster_id/nenhum filtro pro admin), só a lista de status por aba
// é comum. "em_analise" agrupa tudo que tem uma pendência financeira em
// avaliação -- aguardando pagamento, aguardando decisão de reembolso
// (under_review), disputa de chargeback (disputed) e já reembolsado
// (refunded) -- corrige o bug original de "aguardando pagamento" contar como
// "em andamento". "canceled" (cancelamento simples, sem reembolso) não é aba
// própria -- é sub-filtro opcional de "completed" (ver includeCanceled).
export type OrderListTab = 'in_progress' | 'em_analise' | 'completed' | 'all'

// Ordem fixa da lista, igual pros 3 papéis -- ver OrderStatusFilterDropdown.
export const ORDER_LIST_TABS: OrderListTab[] = ['in_progress', 'em_analise', 'completed', 'all']

export type OrderListTabCounts = Record<OrderListTab, number> & { canceled: number }

// Um pedido do booster nunca está em draft/awaiting_payment/awaiting_assignment
// (isso é responsabilidade da página Jobs -- só entra na lista do booster a
// partir de 'assigned') -- incluir esses status na lista de "in_progress" não
// muda nada na prática pro booster, já que ele nunca tem assigned_booster_id
// setado nesses estados.
const IN_PROGRESS_STATUSES: OrderStatus[] = [
  'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer',
]

const EM_ANALISE_STATUSES: OrderStatus[] = ['awaiting_payment', 'under_review', 'disputed', 'refunded']

// 'canceled' nunca entra na aba "completed" por padrão -- só quando o
// checkbox "Cancelados" (ver OrderStatusFilterDropdown) tá marcado.
function completedStatuses(includeCanceled: boolean): OrderStatus[] {
  return includeCanceled ? ['completed', 'canceled'] : ['completed']
}

// null = sem filtro de status além da exclusão padrão (ver HIDDEN_STATUSES_FILTER
// nas queries) -- só 'draft' (carrinho nunca finalizado) nunca entra em
// "Todos"; todo o resto (inclusive canceled) já é coberto por alguma das
// outras 3 abas, então "Todos" é a união real delas.
export function orderListTabStatuses(tab: OrderListTab, includeCanceled = false): OrderStatus[] | null {
  switch (tab) {
    case 'in_progress': return IN_PROGRESS_STATUSES
    case 'em_analise': return EM_ANALISE_STATUSES
    case 'completed': return completedStatuses(includeCanceled)
    case 'all': return null
  }
}

// String pronta pro filtro `.not('status', 'in', ...)` do Postgrest -- só
// draft fica de fora de "Todos" agora.
export const HIDDEN_STATUSES_FILTER = '(draft)'
