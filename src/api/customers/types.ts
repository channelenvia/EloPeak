export interface CustomerDashboardStats {
  activeOrders: number
  completedOrders: number
  totalOrders: number
  totalSpent: number
}

export interface AdminCustomerListRow {
  id: string
  user_id: string
  display_name: string | null
  total_orders: number
  total_spent: number
  created_at: string
  profiles: { email: string; username: string; created_at: string } | null
}

export interface AdminCustomerDetail {
  id: string
  user_id: string
  total_orders: number
  total_spent: number
  created_at: string
  profiles: { id: string; email: string; username: string; created_at: string } | null
}

export interface CustomerReview {
  id: string
  order_id: string
  booster_id: string | null
  rating: number
  content: string | null
  created_at: string
}
