import { supabase } from '@/lib/supabase'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import { normalizeApiError } from '@/api/core/errors'
import type { Order } from '@/types'
import type { AdminCustomerDetail, AdminCustomerListRow, CustomerDashboardStats, CustomerReview } from './types'

export async function getCustomerDashboardStats(customerId: string): Promise<CustomerDashboardStats> {
  const [activeRes, completedRes, profileRes] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer']),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId).eq('status', 'completed'),
    supabase.from('customer_profiles').select('total_orders, total_spent').eq('user_id', customerId).maybeSingle(),
  ])
  if (activeRes.error) throw normalizeApiError(activeRes.error)
  if (completedRes.error) throw normalizeApiError(completedRes.error)
  if (profileRes.error) throw normalizeApiError(profileRes.error)

  return {
    activeOrders: activeRes.count ?? 0,
    completedOrders: completedRes.count ?? 0,
    totalOrders: profileRes.data?.total_orders ?? 0,
    totalSpent: profileRes.data?.total_spent ?? 0,
  }
}

// Só clientes com 1+ pedido nos últimos 30 dias -- customer_profiles não tem
// last_order_at (total_orders/total_spent ali são acumulados vitalícios),
// então a janela recente vem de uma segunda query em orders.created_at.
const ACTIVE_CUSTOMER_WINDOW_MS = 30 * 24 * 60 * 60_000

export async function listAdminCustomers(limit = 100): Promise<AdminCustomerListRow[]> {
  const windowStart = new Date(Date.now() - ACTIVE_CUSTOMER_WINDOW_MS).toISOString()
  const { data: recentOrders, error: ordersError } = await supabase
    .from('orders')
    .select('customer_id')
    .gte('created_at', windowStart)
  if (ordersError) throw normalizeApiError(ordersError)

  const activeCustomerIds = [...new Set((recentOrders ?? []).map((o) => o.customer_id))]
  if (!activeCustomerIds.length) return []

  const { data, error } = await supabase
    .from('customer_profiles')
    .select('*, profiles(email, username, created_at)')
    .in('user_id', activeCustomerIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as AdminCustomerListRow[]
}

export async function getAdminCustomerDetail(customerProfileId: string): Promise<AdminCustomerDetail> {
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('*, profiles(id, email, username, created_at)')
    .eq('id', customerProfileId)
    .single()
  if (error) throw normalizeApiError(error)
  return data as unknown as AdminCustomerDetail
}

export async function listAdminCustomerOrders(customerUserId: string, limit = 50): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SAFE_COLUMNS)
    .eq('customer_id', customerUserId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as Order[]
}

export async function listAdminCustomerReviews(customerUserId: string, limit = 50): Promise<CustomerReview[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, order_id, booster_id, rating, content, created_at')
    .eq('customer_id', customerUserId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return data ?? []
}
