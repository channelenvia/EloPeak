import { supabase } from '@/lib/supabase'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import { normalizeApiError } from '@/api/core/errors'
import type { OrderStatus, ServiceType } from '@/types'
import type {
  BoosterOrdersPage, BoosterOrdersTab, CustomerOrderState, Order, OrderCoachingTopic, OrderDropRequest, OrderMatch,
  OrderRankVerification, OrderStatusHistory, SlotInfo,
} from './types'
import { BOOSTER_ORDER_TAB_STATUSES } from './types'

export async function getOrder(orderId: string): Promise<Order> {
  const { data, error } = await supabase.from('orders').select(ORDER_SAFE_COLUMNS).eq('id', orderId).single()
  if (error) throw normalizeApiError(error, 'Não foi possível carregar o pedido.')
  return data as unknown as Order
}

// Boosters veem pedidos ainda não atribuídos pela view available_boost_orders
// (que já filtra exclusividade/credenciais) antes de aceitar o job -- depois
// de atribuído, a linha só existe mais em orders.
export async function getBoosterOrder(orderId: string): Promise<Order> {
  const { data: pooled } = await supabase.from('available_boost_orders').select('*').eq('id', orderId).maybeSingle()
  if (pooled) return pooled as unknown as Order
  return getOrder(orderId)
}

export async function listCustomerOrders(customerId: string, limit = 100): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SAFE_COLUMNS)
    .eq('customer_id', customerId)
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error, 'Não foi possível carregar seus pedidos.')
  return (data ?? []) as unknown as Order[]
}

// limit bem acima do volume real de pedidos simultâneos aguardando booster --
// com ascending + um limite baixo (era 50), um pedido novo nunca aparecia
// assim que o pool passasse de 50 (os 50 mais ANTIGOS ficam, o resto é
// cortado): o job mais recente literalmente não vinha na resposta, parecendo
// um bug de tempo real quando na verdade era truncamento da consulta.
export async function listAvailableJobs(limit = 300): Promise<Order[]> {
  const { data, error } = await supabase
    .from('available_boost_orders')
    .select('*')
    .eq('status', 'awaiting_assignment')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw normalizeApiError(error, 'Não foi possível carregar os pedidos disponíveis.')
  return (data ?? []) as unknown as Order[]
}

export async function listBoosterOrdersPage(params: {
  boosterId: string
  tab: BoosterOrdersTab
  offset: number
  pageSize: number
}): Promise<BoosterOrdersPage> {
  const { boosterId, tab, offset, pageSize } = params
  const from = offset * pageSize
  const to = from + pageSize - 1
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SAFE_COLUMNS)
    .eq('assigned_booster_id', boosterId)
    .in('status', BOOSTER_ORDER_TAB_STATUSES[tab])
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw normalizeApiError(error, 'Não foi possível carregar seus pedidos.')
  const orders = (data ?? []) as unknown as Order[]
  return { orders, nextOffset: orders.length === pageSize ? offset + 1 : undefined }
}

export async function listAdminOrders(status?: OrderStatus | 'all', serviceType?: ServiceType | 'all', limit = 100): Promise<Order[]> {
  let query = supabase.from('orders').select(ORDER_SAFE_COLUMNS).order('created_at', { ascending: false }).limit(limit)
  if (status && status !== 'all') {
    query = query.eq('status', status)
  } else {
    // "Todos" nunca deve incluir cancelados por padrão -- mesmo padrão de
    // listCustomerOrders (linha acima). Pedidos que expiraram/foram
    // cancelados (pelo cliente ou pelo tempo) somem da visão geral do
    // admin; ainda dá pra ver todos filtrando explicitamente por
    // status='canceled'.
    query = query.neq('status', 'canceled')
  }
  if (serviceType && serviceType !== 'all') query = query.eq('service_type', serviceType)
  const { data, error } = await query
  if (error) throw normalizeApiError(error, 'Não foi possível carregar os pedidos.')
  return (data ?? []) as unknown as Order[]
}

export async function listOrderStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
  const { data, error } = await supabase
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw normalizeApiError(error, 'Não foi possível carregar o histórico do pedido.')
  return data ?? []
}

export async function listOrderMatches(orderId: string): Promise<OrderMatch[]> {
  const { data, error } = await supabase
    .from('order_matches')
    .select('*')
    .eq('order_id', orderId)
    .order('played_at', { ascending: false })
  if (error) throw normalizeApiError(error, 'Não foi possível carregar as partidas do pedido.')
  return (data ?? []) as unknown as OrderMatch[]
}

export async function listOrderCoachingTopics(orderId: string): Promise<OrderCoachingTopic[]> {
  const { data, error } = await supabase
    .from('order_coaching_topics')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw normalizeApiError(error, 'Não foi possível carregar os tópicos do pedido.')
  return (data ?? []) as unknown as OrderCoachingTopic[]
}

export async function getPendingDropRequest(orderId: string): Promise<OrderDropRequest | null> {
  const { data, error } = await supabase
    .from('order_drop_requests')
    .select('*')
    .eq('order_id', orderId)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as unknown as OrderDropRequest | null
}

export async function listOrderRankVerifications(orderId: string, limit = 10): Promise<OrderRankVerification[]> {
  const { data, error } = await supabase
    .from('order_rank_verifications')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as OrderRankVerification[]
}

export async function getCustomerOrderState(orderId?: string): Promise<CustomerOrderState> {
  const { data, error } = await supabase.rpc('get_customer_order_state', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  const state = data as unknown as CustomerOrderState
  if (state?.error) throw normalizeApiError(new Error(state.error))
  return state
}

export async function getBoosterSlotInfo(boosterId: string): Promise<SlotInfo & { allowed: boolean }> {
  const { data, error } = await supabase.rpc('can_booster_accept_order', {
    p_booster_user_id: boosterId,
    p_boost_mode: 'solo',
  })
  if (error) throw normalizeApiError(error)
  return data as unknown as SlotInfo & { allowed: boolean }
}
