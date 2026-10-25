import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import { getCustomerOrderState, useCancelPendingOrder, useGeneratePix } from '@/api/orders'
import { useCountdown } from '@/hooks/useCountdown'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { isPaymentConfirmed } from '@/lib/orderPayment'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import type { Order } from '@/types'

const PAYMENT_POLL_INTERVAL_MS = 5000
const COPIED_FEEDBACK_MS = 2500
const COPY_ERROR_FEEDBACK_MS = 4000

export interface PixCharge {
  qr_code?: string
  qr_code_base64?: string | null
  total_price: number
  expires_at: string
  server_offset_ms?: number
}

// Reconfirma o estado ao vivo do pedido e redireciona se o pagamento já foi
// confirmado -- usada no polling e nos dois pontos que cancelam o pedido (erro
// do cancelamento e timeout do countdown), pra nenhum arriscar cancelar um
// pedido que acabou de ser pago (webhook confirmando no instante do vencimento).
function useRedirectIfPaymentConfirmed(orderId: string) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useCallback(async (): Promise<boolean> => {
    const state = await getCustomerOrderState(orderId).catch((err: unknown) => {
      // Loga a causa real -- senão uma falha de rede fica indistinguível de "ainda não confirmado".
      console.error('Failed to check customer order state', err instanceof Error ? err.message : err)
      return null
    })
    if (!isPaymentConfirmed(state)) return false

    queryClient.setQueryData(queryKeys.orders.state(orderId), state)
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) })
    navigate(`/orders/${orderId}${state?.requires_credentials ? '#credentials' : ''}`, { replace: true })
    return true
  }, [orderId, queryClient, navigate])
}

function useCancelPendingAndLeave(orderId: string, redirectIfPaid: () => Promise<boolean>, clearError: () => void) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { mutate, isPending } = useCancelPendingOrder()
  const cancelOrder = useCallback(() => {
    clearError()
    mutate(orderId, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.customerScope })
        queryClient.removeQueries({ queryKey: queryKeys.orders.detail(orderId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.resumableOrder.all })
        navigate('/orders/new?new=1', { replace: true })
      },
      onError: async () => {
        // O cancelamento pode ter sido rejeitado justamente porque o pagamento
        // acabou de ser confirmado (corrida com o webhook do MP).
        if (await redirectIfPaid()) return
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.customerScope })
        queryClient.invalidateQueries({ queryKey: queryKeys.resumableOrder.all })
        navigate('/orders/new?new=1', { replace: true })
      },
    })
  }, [orderId, mutate, queryClient, navigate, redirectIfPaid, clearError])
  return { cancelOrder, isCancelling: isPending }
}

export function usePendingPayment(order: Order, closeModal: () => void) {
  const queryClient = useQueryClient()
  const [pix, setPix] = useState<PixCharge | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<'card' | null>(null)
  const [cardAcceptance, setCardAcceptance] = useState<CardPaymentAcceptance | null>(null)

  // O modal é aberto pelo badge de status (nunca automaticamente ao visitar ou trocar de pedido).
  const lastOrderIdRef = useRef(order.id)
  useEffect(() => {
    if (lastOrderIdRef.current === order.id) return
    lastOrderIdRef.current = order.id
    closeModal()
    setPix(null)
    setError(null)
    setMethod(null)
    setCardAcceptance(null)
  }, [order.id, closeModal])

  // Offset (servidor - navegador): relogio local adiantado nao pode cancelar o PIX recem-gerado (M-30).
  const { remaining, label } = useCountdown(pix?.expires_at ?? null, pix?.server_offset_ms ?? 0)
  const generatePix = useGeneratePix(order.id)
  const redirectIfPaid = useRedirectIfPaymentConfirmed(order.id)
  const clearError = useCallback(() => setError(null), [])
  const { cancelOrder, isCancelling } = useCancelPendingAndLeave(order.id, redirectIfPaid, clearError)

  // Cartão aprovado já foi conciliado pelo servidor: confere na hora.
  useEffect(() => {
    if (cardAcceptance === 'approved') void redirectIfPaid()
  }, [cardAcceptance, redirectIfPaid])

  useEffect(() => {
    if ((!pix && !cardAcceptance && method !== 'card') || order.status !== 'awaiting_payment') return
    const interval = window.setInterval(async () => {
      const confirmed = await redirectIfPaid()
      if (confirmed) {
        window.clearInterval(interval)
        await queryClient.invalidateQueries({ queryKey: queryKeys.orders.customerScope })
      }
    }, PAYMENT_POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [pix, cardAcceptance, method, order.status, queryClient, redirectIfPaid])

  useEffect(() => {
    if (!pix || remaining !== 0) return
    // Reconfirma ANTES de cancelar por timeout -- o poll pode confirmar o
    // pagamento bem no instante do vencimento.
    void (async () => {
      if (!(await redirectIfPaid())) cancelOrder()
    })()
  }, [remaining, pix, redirectIfPaid, cancelOrder])

  const { mutate: generatePixMutate, isPending: isGeneratingPix } = generatePix
  const loadPix = useCallback(() => {
    setError(null)
    generatePixMutate(undefined, {
      onSuccess: (response) => {
        if (!response.qr_code) { setError('A função não retornou o código PIX.'); return }
        setPix({
          ...response,
          server_offset_ms: response.server_time ? new Date(response.server_time).getTime() - Date.now() : 0,
        })
      },
      onError: (err) => {
        if (err instanceof EdgeFunctionError && err.code === 'CARD_PAYMENT_PENDING') {
          setCardAcceptance('pending')
          return
        }
        setError(pixErrorMessage(err))
      },
    })
  }, [generatePixMutate])

  async function copyPix() {
    if (!pix?.qr_code) return
    try {
      await navigator.clipboard.writeText(pix.qr_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    } catch {
      setCopyError('Não foi possível copiar. Copie o código manualmente.')
      window.setTimeout(() => setCopyError(null), COPY_ERROR_FEEDBACK_MS)
    }
  }

  return {
    pix, copied, copyError, error, method, setMethod, cardAcceptance, setCardAcceptance,
    remaining, label, isGeneratingPix, isCancelling, cancelOrder, loadPix, copyPix,
  }
}
