import { useEffect, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { useMarkOrderChatRead, useOrderChat } from '@/api/chat'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import type { Order } from '@/types'

// Chat sempre visível na página: "estar na página" já é "ter o chat aberto",
// então marca como lida qualquer mensagem nova assim que aparece.
export function useMarkChatReadWhenUnread(orderId: string | undefined, viewerId: string | undefined) {
  const chat = useOrderChat(orderId)
  // `mutate` é estável no TanStack v5 (o objeto da mutation não é).
  const { mutate: markRead } = useMarkOrderChatRead(orderId ?? '')
  const unreadChatCount = (chat.data?.messages ?? [])
    .filter((m) => m.sender_id !== viewerId && !m.is_read).length
  useEffect(() => {
    if (unreadChatCount > 0) markRead()
  }, [unreadChatCount, markRead])
}

// Deep link pós-pagamento (#credentials): rola até a seção "Conta do pedido".
export function useScrollToCredentials(
  ref: RefObject<HTMLDivElement | null>,
  order: Order | undefined,
  requiresCredentials: boolean | undefined,
) {
  useEffect(() => {
    if (window.location.hash === '#credentials' && order && requiresCredentials) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [ref, order, requiresCredentials])
}

// Pedido cancelado e NAO pago volta ao configurador; cancelado depois de pago continua visivel (reembolso).
export function useRedirectCanceledOrder(order: Order | undefined) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (order?.status === 'canceled' && order.payment_status !== 'paid') {
      // Sem ?new=1 o rascunho em andamento sobrevive (M-31); dispensa este pedido e limpa o cache de retomada.
      useOrderBuilderStore.getState().setDismissedOrderId(order.id)
      queryClient.removeQueries({ queryKey: queryKeys.resumableOrder.all })
      navigate('/orders/new', { replace: true })
    }
  }, [order?.id, order?.status, order?.payment_status, navigate, queryClient])
}
