import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { getOrderChat } from './queries'
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
    mutationFn: (content: string) => sendOrderMessage({ orderId, content }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.chat(orderId) }),
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
