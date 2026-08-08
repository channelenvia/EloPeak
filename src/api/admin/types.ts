import type { Order, OrderDropRequest, Refund } from '@/types'

export type { Refund, OrderDropRequest }

export interface AdminDashboardStats {
  total_revenue: number
  total_payouts: number
  platform_profit: number
  active_orders_count: number
  pending_boosters_count: number
  recent_orders: Partial<Order>[]
  daily_orders: { day: string; count: number }[]
}
