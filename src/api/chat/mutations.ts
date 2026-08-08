import { supabase } from '@/lib/supabase'
import { ApiError, normalizeApiError } from '@/api/core/errors'
import { CHAT_ERROR_MESSAGES } from './queries'

interface ChatRpcResult {
  success: boolean
  code?: string
  message?: string
}

function assertChatSuccess(result: ChatRpcResult) {
  if (!result.success) {
    const code = result.code ?? 'unknown_error'
    throw new ApiError(CHAT_ERROR_MESSAGES[code] ?? result.message ?? 'Falha ao enviar mensagem.', { code })
  }
  return result
}

export async function sendOrderMessage(params: { orderId: string; content: string }) {
  const { data, error } = await supabase.rpc('send_order_message', {
    p_order_id: params.orderId, p_content: params.content,
  })
  if (error) throw normalizeApiError(error)
  return assertChatSuccess(data as unknown as ChatRpcResult)
}

export async function setOrderChatLock(params: { orderId: string; locked: boolean }) {
  const { data, error } = await supabase.rpc('admin_set_order_chat_lock', {
    p_order_id: params.orderId, p_locked: params.locked,
  })
  if (error) throw normalizeApiError(error)
  return assertChatSuccess(data as unknown as ChatRpcResult)
}

export async function markOrderChatRead(orderId: string) {
  const { data, error } = await supabase.rpc('mark_order_chat_read', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return assertChatSuccess(data as unknown as ChatRpcResult)
}
