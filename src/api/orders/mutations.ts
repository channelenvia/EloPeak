import { supabase } from '@/lib/supabase'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { ApiError, assertRpcSuccess, normalizeApiError } from '@/api/core/errors'
import type { OrderStatus } from '@/types'
import type { OrderIntent, PixPaymentResponse } from './types'

// add_order_coaching_topic/set_order_coaching_topic_done já devolvem uma
// mensagem amigável em português (result.message) -- sem precisar de um mapa
// de erros client-side como o do chat.
function assertTopicSuccess(result: { success: boolean; code?: string; message?: string }) {
  if (!result.success) {
    throw new ApiError(result.message ?? 'Não foi possível completar a ação.', { code: result.code ?? 'unknown_error' })
  }
  return result
}

export async function setOrderCredentials(params: { orderId: string; login: string; password: string }) {
  const { data, error } = await supabase.rpc('set_order_credentials', {
    p_order_id: params.orderId, p_login: params.login, p_password: params.password,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string; access_token?: string }, {
    invalid_status: 'O pedido não está mais em um status que aceita credenciais.',
    rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  })
}

export async function confirmOrderCompletion(orderId: string) {
  const { data, error } = await supabase.rpc('confirm_order_completion', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}

export async function updateOrderStatus(params: { orderId: string; newStatus: OrderStatus }) {
  const { data, error } = await supabase.rpc('update_order_status', {
    p_order_id: params.orderId, p_new_status: params.newStatus,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, {
    objective_not_reached: 'O rank alvo ainda não foi atingido.',
    requires_rank_verification: 'Use "Verificar Resultado" para concluir — este pedido exige verificação de rank.',
    rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  })
}

export async function addOrderCoachingTopic(params: { orderId: string; content: string }) {
  const { data, error } = await supabase.rpc('add_order_coaching_topic', {
    p_order_id: params.orderId, p_content: params.content,
  })
  if (error) throw normalizeApiError(error)
  return assertTopicSuccess(data as { success: boolean; code?: string; message?: string; topic_id?: string })
}

export async function setOrderCoachingTopicDone(params: { orderId: string; topicId: string; done: boolean }) {
  const { data, error } = await supabase.rpc('set_order_coaching_topic_done', {
    p_order_id: params.orderId, p_topic_id: params.topicId, p_done: params.done,
  })
  if (error) throw normalizeApiError(error)
  return assertTopicSuccess(data as { success: boolean; code?: string; message?: string })
}

export async function adminOverrideOrderStatus(params: { orderId: string; newStatus: OrderStatus; reason?: string }) {
  const { data, error } = await supabase.rpc('admin_override_order_status', {
    p_order_id: params.orderId, p_new_status: params.newStatus, p_reason: params.reason,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}

const ADMIN_DROP_ORDER_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_assigned: 'Este pedido ainda não tem um booster atribuído.',
  order_not_active: 'Este pedido não está mais em um status que aceita drop.',
  drop_limit_reached: 'Limite de drops atingido para este pedido.',
}

export async function adminDropOrder(params: { orderId: string; reason: string }) {
  const { data, error } = await supabase.rpc('admin_drop_order', { p_order_id: params.orderId, p_reason: params.reason })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, ADMIN_DROP_ORDER_MESSAGES)
}

const ADMIN_REASSIGN_BOOSTER_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_assigned: 'Este pedido ainda não tem um booster atribuído.',
  order_not_active: 'Este pedido não está mais em um status que aceita reatribuição.',
  sync_required_before_reassign: 'Sincronize as partidas do pedido antes de reatribuir.',
  already_assigned_to_target: 'Este booster já está atribuído ao pedido.',
  target_booster_not_found: 'Booster não encontrado.',
  target_booster_not_approved: 'Este booster não está com status aprovado -- não é possível atribuir o pedido a ele.',
}

export async function adminReassignBooster(params: { orderId: string; targetBoosterId: string; reason: string }) {
  const { data, error } = await supabase.rpc('admin_reassign_booster', {
    p_order_id: params.orderId, p_target_booster_id: params.targetBoosterId, p_reason: params.reason,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, ADMIN_REASSIGN_BOOSTER_MESSAGES)
}

const ADMIN_MANUAL_REFUND_MESSAGES: Record<string, string> = {
  unauthorized: 'Você não tem permissão para essa ação.',
  invalid_reason: 'O motivo precisa ter pelo menos 10 caracteres.',
  invalid_amount: 'Informe um valor válido, maior que zero.',
  order_not_found: 'Pedido não encontrado. Confira o número.',
  already_refunded: 'Este pedido já foi reembolsado.',
  amount_exceeds_order_total: 'O valor excede o total já disponível pra reembolso neste pedido.',
}

export async function adminCreateManualRefund(params: { orderId: string; reason: string; amount: number }) {
  const { data, error } = await supabase.rpc('admin_create_manual_refund', {
    p_order_id: params.orderId, p_reason: params.reason, p_amount: params.amount,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string; refund_id?: string }, ADMIN_MANUAL_REFUND_MESSAGES)
}

const REQUEST_ORDER_DROP_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_in_progress: 'Este pedido não está mais em andamento.',
  drop_request_already_pending: 'Já existe uma solicitação de drop pendente para este pedido.',
  sync_required_before_drop: 'Sincronize as partidas do pedido antes de solicitar o drop.',
  drop_limit_reached: 'Limite de drops atingido para este pedido.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
}

export async function requestOrderDrop(params: { orderId: string; reason: string }) {
  const { data, error } = await supabase.rpc('request_order_drop', { p_order_id: params.orderId, p_reason: params.reason })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(
    data as { success: boolean; error?: string; penalty_pct?: number; penalty_amount?: number },
    REQUEST_ORDER_DROP_MESSAGES,
  )
}

const REQUEST_CUSTOMER_ORDER_DROP_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_assigned: 'Este pedido ainda não tem um booster atribuído.',
  order_not_active: 'Este pedido não está mais em um status que aceita drop.',
  sync_required_before_drop: 'Sincronize as partidas do pedido antes de solicitar o drop.',
  drop_request_already_pending: 'Já existe uma solicitação de drop pendente para este pedido.',
  drop_limit_reached: 'Limite de drops atingido para este pedido.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
}

export async function requestCustomerOrderDrop(params: { orderId: string; reason: string }) {
  const { data, error } = await supabase.rpc('request_customer_order_drop', {
    p_order_id: params.orderId, p_reason: params.reason,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(
    data as { success: boolean; error?: string; penalty_pct?: number; penalty_amount?: number },
    REQUEST_CUSTOMER_ORDER_DROP_MESSAGES,
  )
}

export async function revealOrderCredentials(orderId: string) {
  const { data, error } = await supabase.rpc('get_order_credentials', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string; access_token?: string; expires_at?: string }, {
    rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  })
}

const ACCEPT_ORDER_MESSAGES: Record<string, string> = {
  order_no_longer_available: 'Este pedido não está mais disponível.',
  slot_limit_reached: 'Você atingiu o limite de pedidos ativos.',
  duo_slot_limit_reached: 'Você atingiu o limite de pedidos Duo ativos.',
  exclusive_slot_already_used: 'Sua vaga exclusiva do mês já foi usada.',
  order_exclusive_to_another_booster: 'Este pedido é exclusivo para outro booster no momento.',
  previously_dropped_by_you: 'Você já dropou este pedido antes — não pode aceitar de novo.',
  booster_not_approved: 'Sua conta de booster ainda não está aprovada.',
  unauthorized: 'Sua sessão expirou. Entre novamente para continuar.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
}

export async function acceptBoostOrder(params: { orderId: string; boosterId: string }) {
  const { data, error } = await supabase.rpc('accept_boost_order', {
    p_order_id: params.orderId, p_booster_user_id: params.boosterId,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, ACCEPT_ORDER_MESSAGES)
}

export async function savePendingOrderFromIntent(params: {
  intent: OrderIntent
  idempotencyKey: string
  preferredBoosterId?: string
}): Promise<PixPaymentResponse> {
  return invokeEdgeFunction<PixPaymentResponse>('create-pix-payment', {
    body: {
      intent: params.intent, idempotency_key: params.idempotencyKey,
      preferred_booster_id: params.preferredBoosterId, save_only: true,
    },
    timeoutMs: 25_000,
    requireAuth: true,
  })
}

export async function generatePix(orderId: string): Promise<PixPaymentResponse> {
  return invokeEdgeFunction<PixPaymentResponse>('create-pix-payment', {
    body: { order_id: orderId },
    timeoutMs: 25_000,
    requireAuth: true,
  })
}

export async function cancelPendingOrder(orderId: string): Promise<void> {
  await invokeEdgeFunction('cancel-pending-order', {
    body: { order_id: orderId },
    timeoutMs: 20_000,
    requireAuth: true,
  })
}

export interface SyncOrderMatchesResult {
  synced: boolean
  reason?: string
  new_matches?: number
}

export async function syncOrderMatches(orderId: string): Promise<SyncOrderMatchesResult> {
  return invokeEdgeFunction<SyncOrderMatchesResult>('sync-order-matches', {
    body: { order_id: orderId },
    timeoutMs: 25_000,
    requireAuth: true,
  })
}

export interface VerifyOrderRankResult {
  passed: boolean
  reason?: string
  fetched_tier?: string
  fetched_division?: string | null
  target_tier?: string
  target_division?: string | null
}

export async function verifyOrderRank(orderId: string): Promise<VerifyOrderRankResult> {
  return invokeEdgeFunction<VerifyOrderRankResult>('verify-order-rank', {
    body: { order_id: orderId },
    requireAuth: true,
  })
}
