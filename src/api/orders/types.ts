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

// Um pedido do booster nunca está em draft/awaiting_payment/awaiting_assignment
// (isso é responsabilidade da página Jobs -- só entra na lista do booster a
// partir de 'assigned'). canceled/refunded/disputed nunca aparecem aqui --
// não é tela de auditoria, isso é só pro admin (ver ADMIN_HIDDEN_STATUSES).
export type BoosterOrdersTab = 'all' | 'active' | 'completed'

const BOOSTER_ACTIVE_STATUSES: OrderStatus[] = ['assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer']
const BOOSTER_COMPLETED_STATUSES: OrderStatus[] = ['completed']

export function boosterOrderTabStatuses(tab: BoosterOrdersTab): OrderStatus[] {
  if (tab === 'active') return BOOSTER_ACTIVE_STATUSES
  if (tab === 'completed') return BOOSTER_COMPLETED_STATUSES
  return [...BOOSTER_ACTIVE_STATUSES, ...BOOSTER_COMPLETED_STATUSES]
}

// Mesmo padrão de 3 abas no admin: Todos/Em andamento/Concluído. "canceled"
// aqui não é uma 4ª aba do mesmo grupo -- é uma auditoria à parte, só pro
// admin, escondida de tudo mais por padrão (ver ADMIN_HIDDEN_STATUSES).
export type AdminOrdersTab = 'all' | 'in_progress' | 'completed' | 'canceled'

// "Aguardando algo" (pagamento, booster, credenciais, drop) conta como
// "em andamento" pro admin -- inclui todo status não-terminal. 'draft' fica
// de fora de propósito: carrinho nunca finalizado não é um pedido de verdade.
export const ADMIN_IN_PROGRESS_STATUSES: OrderStatus[] = [
  'awaiting_payment', 'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer',
]

export const ADMIN_HIDDEN_STATUSES: OrderStatus[] = ['canceled', 'refunded', 'disputed']
