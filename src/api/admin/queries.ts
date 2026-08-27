import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { OrderDropRequest, Payment, Refund } from '@/types'
import type { AdminDashboardStats } from './types'

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats')
  if (error) throw normalizeApiError(error)
  return data as unknown as AdminDashboardStats
}

export async function listAdminRefunds(limit = 100): Promise<Refund[]> {
  const { data, error } = await supabase.from('refunds').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as Refund[]
}

export async function listAdminPayments(limit = 150): Promise<{
  payments: Payment[]
  paidOrderCount: number
  totalReceived: number
}> {
  const [
    { data, error, count },
    { data: dashboardStats, error: dashboardStatsError },
  ] = await Promise.all([
    supabase
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.rpc('admin_dashboard_stats'),
  ])
  if (error) throw normalizeApiError(error)
  if (dashboardStatsError) throw normalizeApiError(dashboardStatsError)

  const stats = dashboardStats as unknown as AdminDashboardStats
  return {
    payments: (data ?? []) as unknown as Payment[],
    paidOrderCount: count ?? 0,
    totalReceived: stats.total_revenue,
  }
}

export async function listAdminDropRequests(limit = 100): Promise<OrderDropRequest[]> {
  const { data, error } = await supabase
    .from('order_drop_requests')
    .select('*, order:orders(drop_count)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as OrderDropRequest[]
}
