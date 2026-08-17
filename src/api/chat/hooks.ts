import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { getOrderChat, getOrderChatMentionTargets } from './queries'
import { sendOrderMessage, setOrderChatLock, markOrderChatRead } from './mutations'

export function useOrderChat(orderId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.orders.chat(orderId ?? ''),
    queryFn: () => getOrderChat(orderId!),
    enabled: !!orderId,
    refetchInterval: 15_000,
  })

  useRealtimeInvalidate({
    channel: `order-chat-${orderId ?? 'none'}`,
    table: 'order_messages',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.chat(orderId)] : [],
    enabled: !!orderId,
  })

  // chat_available/can_send vêm de get_order_chat, que depende de
  // assigned_booster_id/chat_locked em orders -- nenhum dos dois é uma nova
  // linha em order_messages, então a assinatura acima nunca via um booster
  // ser atribuído (ou o chat ser bloqueado/desbloqueado). Sem isso, o chat
  // só destravava no próximo poll de 15s em vez de assim que o pedido
  // mudasse -- mesmo evento (order_status_events) já usado por useOrder/
  // useBoosterOrder pra tudo mais.
  useRealtimeInvalidate({
    channel: `order-chat-status-${orderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    queryKeys: orderId ? [queryKeys.orders.chat(orderId)] : [],
    enabled: !!orderId,
  })

  return query
}

export function useSendOrderMessage(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { content: string; mentionedUserIds?: string[] }) => sendOrderMessage({ orderId, ...params }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.chat(orderId) }),
  })
}

// Quem pode ser mencionado com @ no chat: a outra parte do pedido + todos os
// admins da plataforma (mesma checagem de acesso do próprio chat, ver
// get_order_chat_mention_targets). Só busca quando o chat existir de fato --
// sem booster atribuído não há com quem conversar, então nem tenta.
export function useOrderChatMentionTargets(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.chatMentionTargets(orderId ?? ''),
    queryFn: () => getOrderChatMentionTargets(orderId!),
    enabled: !!orderId && enabled,
    staleTime: 60_000,
  })
}

export function useSetOrderChatLock(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locked: boolean) => setOrderChatLock({ orderId, locked }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.chat(orderId) }),
  })
}

export function useMarkOrderChatRead(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markOrderChatRead(orderId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.chat(orderId) }),
  })
}
