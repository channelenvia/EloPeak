import { supabase } from '@/lib/supabase'
import { ApiError, normalizeApiError } from '@/api/core/errors'
import type { OrderChatState } from './types'

export const CHAT_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Sua sessão expirou. Entre novamente para continuar.',
  profile_not_found: 'Perfil não encontrado.',
  order_not_found: 'Pedido não encontrado.',
  chat_unavailable: 'O chat ainda não está disponível para este pedido.',
  chat_locked: 'O chat deste pedido está bloqueado.',
  forbidden: 'Você não tem acesso a este chat.',
}

export async function getOrderChat(orderId: string): Promise<OrderChatState> {
  const { data, error } = await supabase.rpc('get_order_chat', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  const state = data as unknown as OrderChatState
  if (!state.success) {
    const code = state.code ?? 'chat_unavailable'
    throw new ApiError(CHAT_ERROR_MESSAGES[code] ?? state.message ?? 'Não foi possível carregar o chat.', { code })
  }
  return state
}
