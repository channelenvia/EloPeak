import type {
  Order, OrderCoachingTopic, OrderDropRequest, OrderMatch, OrderRankVerification, OrderStatus, OrderStatusHistory, Payment,
} from '@/types'

export type { Order, OrderCoachingTopic, OrderDropRequest, OrderMatch, OrderRankVerification, OrderStatusHistory, Payment }

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

export type BoosterOrdersTab = 'active' | 'completed' | 'canceled'

export const BOOSTER_ORDER_TAB_STATUSES: Record<BoosterOrdersTab, OrderStatus[]> = {
  active: ['assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer'],
  completed: ['completed'],
  canceled: ['canceled', 'refunded', 'disputed'],
}
