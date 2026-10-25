import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isCardPaymentInAnalysis, isPaymentConfirmed } from '@/lib/orderPayment'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { queryKeys } from '@/api/core/queryKeys'
import { getCustomerOrderState, useOrderPaymentInfo } from '@/api/orders'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import type { PaymentMethod } from '@/components/order/PaymentMethodPicker'
import type { NavigateFunction } from 'react-router-dom'
import { useLatestRef } from './useLatestRef'
import { orderDetailPath, type PixState } from './paymentTypes'

const POLL_INTERVAL_MS = 4000
const REDIRECT_DELAY_MS = 1500

interface Params {
  pix: PixState
  method: PaymentMethod | null
  cardAcceptance: CardPaymentAcceptance | null
  savedOrderId: string | null
  setPix: Dispatch<SetStateAction<PixState>>
  setCardAcceptance: Dispatch<SetStateAction<CardPaymentAcceptance | null>>
  resetStore: () => void
  navigate: NavigateFunction
}

// Confirmação do pagamento: query com refetch a cada 4s (pausa com a aba
// escondida, refaz ao voltar o foco) + Realtime em order_status_events, que
// dispara a checagem na hora em vez de esperar o próximo ciclo.
export function usePaymentWatch(params: Params) {
  const { pix, method, cardAcceptance, savedOrderId, setPix, setCardAcceptance } = params
  const queryClient = useQueryClient()
  const confirmedHandledRef = useRef(false)

  const watchedOrderId = pix.phase === 'waiting'
    ? pix.order_id
    : cardAcceptance || method === 'card' ? savedOrderId : null
  const { data: watchedState } = useQuery({
    queryKey: queryKeys.pixPaymentState(watchedOrderId),
    queryFn: () => getCustomerOrderState(watchedOrderId!),
    enabled: !!watchedOrderId,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  })
  useRealtimeInvalidate({
    channel: `pix-${watchedOrderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: watchedOrderId ? `order_id=eq.${watchedOrderId}` : undefined,
    queryKeys: [queryKeys.pixPaymentState(watchedOrderId)],
    enabled: !!watchedOrderId,
  })

  // Retomada de um pedido cujo cartão já foi enviado e segue em análise.
  const { data: paymentInfo } = useOrderPaymentInfo(savedOrderId ?? undefined, !!savedOrderId && !cardAcceptance)
  useEffect(() => {
    if (isCardPaymentInAnalysis(paymentInfo)) setCardAcceptance('pending')
  }, [paymentInfo, setCardAcceptance])

  // Cartão aprovado já foi conciliado pelo servidor: confere na hora em vez de
  // esperar o próximo ciclo do polling.
  useEffect(() => {
    if (cardAcceptance === 'approved' && savedOrderId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pixPaymentState(savedOrderId) })
    }
  }, [cardAcceptance, savedOrderId, queryClient])

  const latest = useLatestRef({ params, watchedState })
  useEffect(() => {
    const { params: p, watchedState: state } = latest.current
    if (!watchedOrderId || !isPaymentConfirmed(state) || confirmedHandledRef.current) return
    confirmedHandledRef.current = true
    const requiresCredentials = state?.requires_credentials === true
    setPix({ phase: 'confirmed' })
    p.resetStore()
    // Sem cleanup de propósito: ao confirmar, watchedOrderId vira null e este
    // efeito roda de novo -- um clearTimeout aqui cancelaria o redirecionamento.
    window.setTimeout(() => p.navigate(orderDetailPath(watchedOrderId, requiresCredentials), { replace: true }), REDIRECT_DELAY_MS)
  }, [watchedOrderId, watchedState?.payment_confirmed, watchedState?.payment_status, latest, setPix])
}
