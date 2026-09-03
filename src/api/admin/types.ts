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

export interface AdminDashboardStats {
  total_revenue: number
  total_payouts: number
  platform_profit: number
  active_orders_count: number
  pending_boosters_count: number
  recent_orders: Partial<Order>[]
  daily_orders: { day: string; count: number }[]
}
