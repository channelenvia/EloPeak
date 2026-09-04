import { supabase } from '@/lib/supabase'
import { ORDER_SAFE_COLUMNS } from '@/lib/orderColumns'
import { normalizeApiError } from '@/api/core/errors'
import type { ServiceType } from '@/types'
import type {
  AdminOrdersTab, BoosterDuoMatch, BoosterOrdersPage, BoosterOrdersTab, CustomerOrderState, DuoAccountHistoryEntry, Order, OrderCoachingTopic, OrderDropRequest, OrderMatch,
  OrderRankVerification, OrderStatusHistory, SlotInfo,
} from './types'
import { ADMIN_HIDDEN_STATUSES, ADMIN_IN_PROGRESS_STATUSES, boosterOrderTabStatuses } from './types'

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
    // draft (carrinho nunca finalizado) e canceled/refunded/disputed nunca
    // aparecem pro cliente -- só o admin tem uma auditoria à parte pra esses.
    .not('status', 'in', '(draft,canceled,refunded,disputed)')
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
    .in('status', boosterOrderTabStatuses(tab))
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw normalizeApiError(error, 'Não foi possível carregar seus pedidos.')
  const orders = (data ?? []) as unknown as Order[]
  return { orders, nextOffset: orders.length === pageSize ? offset + 1 : undefined }
}

export async function listAdminOrders(tab: AdminOrdersTab = 'all', serviceType?: ServiceType | 'all', limit = 100): Promise<Order[]> {
  let query = supabase.from('orders').select(ORDER_SAFE_COLUMNS).order('created_at', { ascending: false }).limit(limit)
  if (tab === 'completed') {
    query = query.eq('status', 'completed')
  } else if (tab === 'in_progress') {
    // "Aguardando algo" (pagamento, booster, credenciais, drop) conta como
    // em andamento pro admin -- é a correção do bug de "Aguardando Booster"
    // aparecer como aba própria separada de "Em andamento".
    query = query.in('status', ADMIN_IN_PROGRESS_STATUSES)
  } else if (tab === 'canceled') {
    // Auditoria -- único lugar do sistema (só pro admin) que mostra
    // cancelados/reembolsados/disputados.
    query = query.in('status', ADMIN_HIDDEN_STATUSES)
  } else {
    // "Todos" nunca inclui draft (carrinho nunca finalizado) nem
    // cancelados/reembolsados/disputados -- auditoria é opt-in (aba "Cancelados").
    query = query.not('status', 'in', '(draft,canceled,refunded,disputed)')
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

// Partidas jogadas na conta duo do booster (própria ou do pool) -- mesmo
// pedido de order_matches, mas a conta é sempre a do cliente lá; aqui é
// sempre a conta duo. Mesma RLS de order_matches (cliente/booster/admin do
// pedido), ver migration 149.
export async function listOrderBoosterDuoMatches(orderId: string): Promise<BoosterDuoMatch[]> {
  const { data, error } = await supabase
    .from('booster_duo_matches')
    .select('*')
    .eq('order_id', orderId)
    .order('played_at', { ascending: false })
  if (error) throw normalizeApiError(error, 'Não foi possível carregar as partidas do booster.')
  return (data ?? []) as unknown as BoosterDuoMatch[]
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

export async function getOrderDuoPartnerRiotId(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_order_duo_partner_riot_id', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return (data as string | null) ?? null
}

// Só chamado quando o pedido já está concluído -- histórico completo de
// contas Duo associadas (conta própria + reservas de pool), mais recente
// primeiro. Ver get_order_duo_account_history (migration 20260815010000).
export async function getOrderDuoAccountHistory(orderId: string): Promise<DuoAccountHistoryEntry[]> {
  const { data, error } = await supabase.rpc('get_order_duo_account_history', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  const result = data as unknown as { success: boolean; error?: string; history?: DuoAccountHistoryEntry[] }
  if (result.error) throw normalizeApiError(new Error(result.error))
  return result.history ?? []
}

// Booster não consegue ler profiles.username do cliente direto (RLS só
// libera a própria linha ou admin) -- get_order_customer_nickname (migration
// 171) expõe isso restrito a quem tá atribuído ao pedido.
export async function getOrderCustomerNickname(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_order_customer_nickname', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return (data as string | null) ?? null
}

// payments.amount é o valor gravado na hora do pagamento, nunca mutado
// depois (record_pix_payment) -- diferente de orders.total_price, que muda
// a cada drop/reatribuição pra refletir o valor pro PRÓXIMO booster (pode
// crescer num drop negativo), não o que o cliente de fato pagou. "Total
// pago" no admin tem que vir daqui, não de orders.total_price.
export async function getOrderPaidAmount(orderId: string): Promise<number> {
  const { data, error } = await supabase
    .from('payments')
    .select('amount')
    .eq('order_id', orderId)
    .eq('status', 'paid')
  if (error) throw normalizeApiError(error)
  return (data ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
}

export async function getBoosterSlotInfo(boosterId: string): Promise<SlotInfo & { allowed: boolean }> {
  const { data, error } = await supabase.rpc('can_booster_accept_order', {
    p_booster_user_id: boosterId,
    p_boost_mode: 'solo',
  })
  if (error) throw normalizeApiError(error)
  return data as unknown as SlotInfo & { allowed: boolean }
}
