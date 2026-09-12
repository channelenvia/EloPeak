import type { Order, OrderDropRequest, OrderStatus, Refund } from '@/types'

export type { Refund, OrderDropRequest }

export interface AdminReviewCase {
  order_id: string
  order_status: OrderStatus
  total_price: number
  customer_id: string | null
  last_assigned_booster_id: string | null
  drop_count: number
  refunded_amount: number
  updated_at: string
}

export interface AuditLogEntry {
  id: string
  actor_id: string
  actor_role: string
  action: string
  entity_type: string
  entity_id: string
  diff: Record<string, unknown> | null
  created_at: string
  actor: { username: string | null } | null
}

export interface AdminDashboardStats {
  total_revenue: number
  total_payouts: number
  platform_profit: number
  active_orders_count: number
  pending_boosters_count: number
  recent_orders: Partial<Order>[]
  daily_orders: { day: string; count: number }[]
}
