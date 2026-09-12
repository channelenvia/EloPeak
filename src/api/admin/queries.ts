import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import type { Order, OrderDropRequest, Payment, Refund } from '@/types'
import type { AdminDashboardStats, AdminReviewCase, AuditLogEntry } from './types'

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

export async function listPendingReviewOrders(): Promise<Order[]> {
  // admin_review_locked/review_release_at ficam de fora de ORDER_SAFE_COLUMNS
  // de propósito (é a projeção também usada pra cliente/booster, que não
  // precisam ver o estado interno da janela de revisão) -- por isso são
  // selecionados à parte aqui, só nesta lista admin-only. Sem eles, o toggle
  // de cadeado do PendingReviewPanel sempre lia `undefined` (falsy) e nunca
  // refletia o travamento real nem a contagem regressiva.
  const { data, error } = await supabase
    .from('orders')
    .select(`${ORDER_SAFE_COLUMNS},admin_review_locked,review_release_at`)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as Order[]
}

export async function listAdminReviewCases(): Promise<AdminReviewCase[]> {
  const { data, error } = await supabase.rpc('admin_list_review_cases')
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as AdminReviewCase[]
}

export async function listAdminDropRequests(limit = 100): Promise<OrderDropRequest[]> {
  const { data, error } = await supabase
    .from('order_drop_requests')
    .select('*, order:orders(drop_count, service_type)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as OrderDropRequest[]
}

// Toda ação administrativa (drop, reassign, refund, override, ajuste de
// saldo, resolução de conta duo, etc.) já grava aqui com o motivo dado pelo
// admin -- só nunca teve tela nenhuma pra ler de volta (audit_logs tinha a
// RLS policy certa desde sempre, mas faltava o grant de tabela, ver
// migration 20260911080000). Mesmo padrão de limit fixo + aviso usado em
// listAdminDropRequests/listAdminPayments -- paginação real de servidor não
// vale a complexidade enquanto o volume não justificar.
export async function listAuditLogs(limit = 300): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*, actor:profiles(username)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as AuditLogEntry[]
}

export async function getProfileUsername(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('username').eq('id', profileId).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.username ?? null
}

// Batch de vários ids de uma vez em vez de uma query por card (N+1) --
// mesmo padrão de listBoosterNames (src/api/boosters/queries.ts).
export async function listProfileUsernames(profileIds: string[]): Promise<Map<string, string>> {
  if (profileIds.length === 0) return new Map()
  const { data, error } = await supabase.from('profiles').select('id, username').in('id', profileIds)
  if (error) throw normalizeApiError(error)
  return new Map((data ?? []).map((p) => [p.id, p.username as string]))
}

export async function getOrderParties(customerId: string, boosterUserIds: string[]): Promise<{
  customerUsername: string | null
  boosterByUserId: Map<string, { id: string; user_id: string; display_name: string }>
}> {
  const [{ data: customer, error: customerError }, { data: boosters, error: boostersError }] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', customerId).maybeSingle(),
    boosterUserIds.length
      ? supabase.from('booster_profiles').select('id, user_id, display_name').in('user_id', boosterUserIds)
      : Promise.resolve({ data: [] as { id: string; user_id: string; display_name: string }[], error: null }),
  ])
  if (customerError) throw normalizeApiError(customerError)
  if (boostersError) throw normalizeApiError(boostersError)
  return {
    customerUsername: customer?.username ?? null,
    boosterByUserId: new Map((boosters ?? []).map((b) => [b.user_id, b])),
  }
}
