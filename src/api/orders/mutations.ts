import { supabase } from '@/lib/supabase'
import { callRpc } from '@/api/core/rpc'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { ApiError, assertRpcSuccess, normalizeApiError } from '@/api/core/errors'
import type { OrderStatus } from '@/types'
import type { CardPaymentRequest, CardPaymentResponse, OrderIntent, PixPaymentResponse } from './types'

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
  return callRpc('set_order_credentials', {
    p_order_id: params.orderId, p_login: params.login, p_password: params.password,
  }, {
    invalid_status: 'O pedido não está mais em um status que aceita credenciais.',
    rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  }) as Promise<{ success: boolean; error?: string; access_token?: string }>
}

export async function disputeOrderCompletion(params: { orderId: string; reason: string }) {
  return callRpc('dispute_order_completion', { p_order_id: params.orderId, p_reason: params.reason }, {
    invalid_reason: 'Conte o motivo da contestação (10 a 500 caracteres).',
    invalid_status: 'Este pedido não está mais aguardando a sua confirmação.',
    unauthorized: 'Você não pode contestar este pedido.',
    rate_limited: 'Muitas tentativas. Aguarde um minuto.',
  })
}

export async function confirmOrderCompletion(orderId: string) {
  return callRpc('confirm_order_completion', { p_order_id: orderId }, {
    no_booster_assigned: 'Este pedido ainda não tem booster atribuído.',
    invalid_status: 'O pedido não está aguardando a sua confirmação.',
    rate_limited: 'Muitas tentativas. Aguarde um minuto.',
  })
}

// wins_played/losses_played (gate de "objetivo atingido" aqui, e a base do
// cálculo de penalidade em apply_order_drop pros RPCs de drop abaixo) só
// ficam corretos com o sync da Riot mais recente possível -- sem isso, uma
// vitória/derrota já jogada mas ainda não sincronizada fica de fora da conta
// no exato momento em que ela é lida pra decidir dinheiro ou destravar o
// status. Best-effort de propósito: falha de sync (Riot fora do ar, rate
// limit etc.) não pode bloquear a ação em si, só significa que ela roda com
// o que já estava sincronizado antes. Devolve o erro (em vez de só logar) pra
// quem chamou poder explicar um eventual sync_required_before_* do RPC
// seguinte -- sem isso esse erro ficava mudo e reatribuir/dropar parecia
// travado num loop sem explicação (histórico "nunca sincroniza sozinho").
async function bestEffortSyncBeforeAction(orderId: string): Promise<Error | null> {
  try {
    await syncOrderMatches(orderId)
    return null
  } catch (err) {
    console.error('bestEffortSyncBeforeAction failed', orderId, err)
    return err instanceof Error ? err : new Error('Falha desconhecida ao sincronizar partidas')
  }
}

// Códigos que o RPC só devolve quando o sync automático acima deveria ter
// resolvido a pendência sozinho -- se ele falhou (syncError não nulo), o
// motivo real está ali, não em "sincronize antes" genérico.
const SYNC_REQUIRED_ERROR_CODES = new Set(['sync_required_before_reassign', 'sync_required_before_drop'])

export function assertRpcSuccessAfterSync<T extends { success?: boolean; error?: string }>(
  result: T,
  messages: Record<string, string>,
  syncError: Error | null,
): T {
  if (result.success === false && syncError && result.error && SYNC_REQUIRED_ERROR_CODES.has(result.error)) {
    const base = messages[result.error] ?? 'Sincronize as partidas antes de continuar.'
    throw new ApiError(`${base} A sincronização automática falhou: ${syncError.message}`, { code: result.error, cause: syncError })
  }
  return assertRpcSuccess(result, messages)
}

export async function updateOrderStatus(params: { orderId: string; newStatus: OrderStatus }) {
  await bestEffortSyncBeforeAction(params.orderId)
  return callRpc('update_order_status', {
    p_order_id: params.orderId, p_new_status: params.newStatus,
  }, {
    objective_not_reached: 'O rank alvo ainda não foi atingido.',
    requires_rank_verification: 'Use "Verificar Resultado" para concluir — este pedido exige verificação de rank.',
    no_matches_played: 'Sincronize ao menos 1 partida deste pedido antes de marcar como concluído.',
    clash_completion_window_closed: 'Clash só pode ser marcado como concluído a partir das 23h.',
    invalid_transition: 'Essa mudança de status não é permitida agora.',
    invalid_status: 'Status inválido.',
    unauthorized: 'Você não pode alterar este pedido.',
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

const ADMIN_OVERRIDE_STATUS_MESSAGES: Record<string, string> = {
  unauthorized: 'Você não tem permissão para essa ação.',
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  use_admin_drop_order_instead: 'Para este status, use a ação de drop em vez do override direto.',
  order_not_found: 'Pedido não encontrado.',
  no_status_change: 'O pedido já está neste status.',
  invalid_status: 'Status inválido.',
  invalid_transition: 'Essa mudança de status não é permitida a partir do status atual.',
  order_terminal: 'Pedido já finalizado (concluído, cancelado ou reembolsado) não pode ser reaberto por aqui.',
  use_resolution_flow: 'Resolva o drop/revisão pelo fluxo próprio antes de mudar o status.',
  use_refund_flow: 'Reembolso é feito pelo fluxo de reembolso.',
  use_cancel_in_progress_flow: 'Pedido com booster só pode ser cancelado pelo fluxo de cancelamento em andamento.',
  no_booster_assigned: 'O pedido não tem booster atribuído.',
  order_not_paid: 'O pedido não está pago.',
  rate_limited: 'Muitas tentativas. Aguarde um minuto.',
}

export async function adminOverrideOrderStatus(params: { orderId: string; newStatus: OrderStatus; reason?: string }) {
  return callRpc('admin_override_order_status', {
    p_order_id: params.orderId, p_new_status: params.newStatus, p_reason: params.reason,
  }, ADMIN_OVERRIDE_STATUS_MESSAGES)
}

// O limite de 2 drops não bloqueia mais o admin_drop_order -- a 3ª chamada
// tem sucesso normalmente (success: true) e cancela o pedido pra
// 'under_review' em vez de reabrir (ver apply_order_drop). Não há mais um
// erro drop_limit_reached vindo daqui; o aviso "isso vai cancelar" já é
// mostrado ao admin ANTES de confirmar, no próprio modal (willCancel em
// OrderDetail.tsx, calculado client-side a partir de order.drop_count).
const ADMIN_DROP_ORDER_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_assigned: 'Este pedido ainda não tem um booster atribuído.',
  order_not_active: 'Este pedido não está mais em um status que aceita drop.',
  order_not_found_or_unassigned: 'Não foi possível calcular o valor do drop -- pedido não encontrado ou sem booster atribuído.',
  missing_rank_data: 'Este pedido está sem rank atual/alvo definido -- não é possível calcular o valor do drop.',
}

export async function adminDropOrder(params: { orderId: string; reason: string; coachingCompletionPct?: number }) {
  const syncError = await bestEffortSyncBeforeAction(params.orderId)
  const { data, error } = await supabase.rpc('admin_drop_order', {
    p_order_id: params.orderId, p_reason: params.reason,
    p_coaching_completion_pct: params.coachingCompletionPct ?? undefined,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccessAfterSync(data as { success: boolean; error?: string }, ADMIN_DROP_ORDER_MESSAGES, syncError)
}

const ADMIN_REASSIGN_BOOSTER_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo pode ter no máximo 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_active: 'Este pedido não está mais em um status que aceita atribuição de booster.',
  sync_required_before_reassign: 'Sincronize as partidas do pedido antes de reatribuir.',
  already_assigned_to_target: 'Este booster já está atribuído ao pedido.',
  target_booster_not_found: 'Booster não encontrado.',
  target_booster_not_approved: 'Este booster não está com status aprovado -- não é possível atribuir o pedido a ele.',
  // Repassados de apply_order_drop quando a reatribuição aplica a fórmula de
  // valor por progresso (ver migration 20260903150400).
  drop_limit_reached: 'Este pedido atingiu o limite de 2 drops -- foi cancelado e está em análise manual (aba "A analisar"), a reatribuição não foi feita.',
  order_not_found_or_unassigned: 'Não foi possível calcular o valor da reatribuição -- pedido não encontrado ou sem booster atribuído.',
  missing_rank_data: 'Este pedido está sem rank atual/alvo definido -- não é possível calcular o valor da reatribuição.',
}

export async function adminReassignBooster(params: { orderId: string; targetBoosterId: string; reason: string; coachingCompletionPct?: number }) {
  const syncError = await bestEffortSyncBeforeAction(params.orderId)
  const { data, error } = await supabase.rpc('admin_reassign_booster', {
    p_order_id: params.orderId, p_target_booster_id: params.targetBoosterId, p_reason: params.reason,
    p_coaching_completion_pct: params.coachingCompletionPct ?? undefined,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccessAfterSync(data as { success: boolean; error?: string }, ADMIN_REASSIGN_BOOSTER_MESSAGES, syncError)
}

const PENDING_REVIEW_MESSAGES: Record<string, string> = {
  order_not_found: 'Pedido não encontrado.',
  order_not_pending_review: 'Este pedido não está mais em um status que aceita esta ação.',
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  target_booster_not_found: 'Booster não encontrado.',
  target_booster_not_approved: 'Este booster não está com status aprovado -- não é possível atribuir o pedido a ele.',
  // Só admin_assign_pending_review_order devolve este -- pedido já foi
  // pego por outro booster entre a lista carregar e o admin confirmar.
  order_has_active_booster: 'Este pedido já tem um booster atribuído -- atualize a página.',
}

export async function adminSetPendingReviewLock(params: { orderId: string; locked: boolean }) {
  return callRpc('admin_set_pending_review_lock', {
    p_order_id: params.orderId, p_locked: params.locked,
  }, PENDING_REVIEW_MESSAGES)
}

export async function adminCancelPendingReviewOrder(params: { orderId: string; reason: string }) {
  return callRpc('admin_cancel_pending_review_order', {
    p_order_id: params.orderId, p_reason: params.reason,
  }, PENDING_REVIEW_MESSAGES)
}

export async function adminAssignPendingReviewOrder(params: { orderId: string; targetBoosterId: string; reason: string }) {
  return callRpc('admin_assign_pending_review_order', {
    p_order_id: params.orderId, p_target_booster_id: params.targetBoosterId, p_reason: params.reason,
  }, PENDING_REVIEW_MESSAGES)
}

const FLAG_UNDER_REVIEW_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_active: 'Este pedido não está mais em um status que aceita esta ação.',
  // Repassados de apply_order_drop quando havia booster ativo (ver
  // migration 20260906190000).
  order_not_found_or_unassigned: 'Não foi possível calcular o valor do progresso -- pedido não encontrado ou sem booster atribuído.',
  order_status_mismatch: 'O status do pedido mudou -- atualize a página e tente novamente.',
  missing_rank_data: 'Este pedido está sem rank atual/alvo definido -- não é possível calcular o valor do progresso.',
}

export async function adminFlagOrderUnderReview(params: { orderId: string; reason: string }) {
  return callRpc('admin_flag_order_under_review', {
    p_order_id: params.orderId, p_reason: params.reason,
  }, FLAG_UNDER_REVIEW_MESSAGES)
}

const ADMIN_MANUAL_REFUND_MESSAGES: Record<string, string> = {
  unauthorized: 'Você não tem permissão para essa ação.',
  invalid_reason: 'O motivo precisa ter pelo menos 10 caracteres.',
  order_not_under_review: 'Marque o pedido como "Analisar" antes de reembolsar ou cancelar.',
  order_not_paid: 'O pedido não está pago.',
  nothing_to_refund: 'Não há valor a reembolsar: tudo já foi consumido ou reservado para reembolso.',
  rate_limited: 'Muitas tentativas. Aguarde um minuto.',
  order_not_found: 'Pedido não encontrado. Confira o número.',
  already_refunded: 'Este pedido já foi reembolsado.',
  amount_exceeds_order_total: 'O valor excede o total já disponível pra reembolso neste pedido.',
  payment_not_found: 'Este pedido não tem pagamento para reembolsar.',
  refund_not_found: 'Reembolso não encontrado.',
  refund_not_pending: 'Este reembolso já foi confirmado ou desfeito.',
}

// Sem valor digitado (RN-04): o servidor calcula progresso, credito do booster e reembolso.
export async function adminCreateManualRefund(params: { orderId: string; reason: string; coachingPct?: number }) {
  return callRpc('admin_create_manual_refund', {
    p_order_id: params.orderId, p_reason: params.reason, p_coaching_pct: params.coachingPct,
  }, ADMIN_MANUAL_REFUND_MESSAGES) as Promise<{ success: boolean; error?: string; refund_id?: string }>
}

export async function adminConfirmManualRefund(refundId: string) {
  return callRpc('admin_confirm_manual_refund', { p_refund_id: refundId }, ADMIN_MANUAL_REFUND_MESSAGES)
}

export async function adminCancelManualRefund(refundId: string) {
  return callRpc('admin_cancel_manual_refund', { p_refund_id: refundId }, ADMIN_MANUAL_REFUND_MESSAGES)
}

const REQUEST_ORDER_DROP_MESSAGES: Record<string, string> = {
  invalid_reason: 'O motivo precisa ter entre 10 e 500 caracteres.',
  order_not_found: 'Pedido não encontrado.',
  order_not_in_progress: 'Este pedido não está mais em andamento.',
  order_not_active: 'Este pedido não está mais em um status que aceita drop.',
  drop_request_already_pending: 'Já existe uma solicitação de drop pendente para este pedido.',
  sync_required_before_drop: 'Sincronize as partidas do pedido antes de solicitar o drop.',
  drop_limit_reached: 'Limite de drops atingido para este pedido.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
}

export async function requestOrderDrop(params: { orderId: string; reason: string }) {
  const syncError = await bestEffortSyncBeforeAction(params.orderId)
  const { data, error } = await supabase.rpc('request_order_drop', { p_order_id: params.orderId, p_reason: params.reason })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccessAfterSync(
    data as { success: boolean; error?: string; penalty_pct?: number; penalty_amount?: number },
    REQUEST_ORDER_DROP_MESSAGES,
    syncError,
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
  const syncError = await bestEffortSyncBeforeAction(params.orderId)
  const { data, error } = await supabase.rpc('request_customer_order_drop', {
    p_order_id: params.orderId, p_reason: params.reason,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccessAfterSync(
    data as { success: boolean; error?: string; penalty_pct?: number; penalty_amount?: number },
    REQUEST_CUSTOMER_ORDER_DROP_MESSAGES,
    syncError,
  )
}

export async function revealOrderCredentials(orderId: string) {
  return callRpc('get_order_credentials', { p_order_id: orderId }, {
    rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
  }) as Promise<{ success: boolean; error?: string; access_token?: string; expires_at?: string }>
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
  captcha_required: 'A verificação de segurança expirou. Tente aceitar o job de novo.',
  legal_not_accepted: 'Aceite os Termos de Uso e a Política de Privacidade vigentes para continuar.',
}

export async function acceptBoostOrder(params: { orderId: string; boosterId: string; challengeId: string }) {
  return callRpc('accept_boost_order', {
    p_order_id: params.orderId, p_booster_user_id: params.boosterId, p_challenge_id: params.challengeId,
  }, ACCEPT_ORDER_MESSAGES)
}

// Captcha do aceite (RN-12): o desafio e a resposta ficam no servidor; o navegador so recebe o id opaco e
// a URL da imagem mascarada.
export interface AcceptChallenge {
  challenge_id: string
  image_url: string
  expires_in: number
}

export interface AcceptChallengeVerification {
  success: boolean
  error?: string
  attempts_left?: number
}

export function issueAcceptChallenge(orderId: string) {
  return invokeEdgeFunction<AcceptChallenge>('accept-challenge', {
    body: { action: 'issue', order_id: orderId }, requireAuth: true,
  })
}

export function verifyAcceptChallenge(challengeId: string, answer: string) {
  return invokeEdgeFunction<AcceptChallengeVerification>('accept-challenge', {
    body: { action: 'verify', challenge_id: challengeId, answer }, requireAuth: true,
  })
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

export async function payWithCard(params: CardPaymentRequest): Promise<CardPaymentResponse> {
  return invokeEdgeFunction<CardPaymentResponse>('create-card-payment', {
    body: {
      order_id: params.orderId,
      idempotency_key: params.idempotencyKey,
      token: params.token,
      payment_method_id: params.paymentMethodId,
      issuer_id: params.issuerId ?? undefined,
      installments: params.installments,
      identification: params.identification ?? undefined,
    },
    timeoutMs: 30_000,
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

// Cancela um pedido em analise SEM devolver dinheiro ao cliente (o booster recebe pelo progresso); o servidor calcula tudo.
export async function adminCancelPaidOrder(params: { orderId: string; reason: string }) {
  return callRpc('admin_cancel_paid_order', {
    p_order_id: params.orderId, p_reason: params.reason,
  }, ADMIN_MANUAL_REFUND_MESSAGES) as Promise<{ success: boolean; error?: string }>
}
