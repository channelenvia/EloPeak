import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { isUuid } from '@/lib/utils'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import { savePendingOrderFromIntent } from '@/api/orders'
import type { PaymentMethod } from '@/components/order/PaymentMethodPicker'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import { buildOrderIntent } from './buildOrderIntent'
import { estimateTotal, type PaymentStore, type PixState } from './paymentTypes'
import {
  cancelPendingOrder, invalidateOrderLists, invokePix, redirectIfPaid, stopQrRetry, type PixContext,
} from './pixActions'
import { useAddonInputs } from './useAddonInputs'
import { usePaymentWatch } from './usePaymentWatch'
import { usePixExpiry } from './usePixExpiry'
import { useRestoreOrder } from './useRestoreOrder'

export function usePixPayment(store: PaymentStore) {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingOrderId = searchParams.get('order')
  const { flow, addonCodes, addonsReady } = useAddonInputs(store)
  const [pix, setPix] = useState<PixState>({ phase: 'idle' })
  const [savedOrderId, setSavedOrderId] = useState<string | null>(pendingOrderId)
  const [savedTotalPrice, setSavedTotalPrice] = useState<number | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [cardAcceptance, setCardAcceptance] = useState<CardPaymentAcceptance | null>(null)
  // Só gera o PIX automático depois da checagem do pedido já existente (?order=).
  const [restoreDone, setRestoreDone] = useState(!pendingOrderId)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const generatingRef = useRef(false)
  const qrRetryTimeoutRef = useRef<number | null>(null)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const restoredOrderRef = useRef<string | null>(null)
  const expiryHandledRef = useRef(false)

  const resetStore = store.reset
  const ctx: PixContext = {
    setPix, resetStore, navigate, queryClient, setSearchParams, setSavedOrderId,
    setSavedTotalPrice, setCardAcceptance, idempotencyKeyRef, qrRetryTimeoutRef,
  }

  // O valor cobrado de fato é sempre o que a Edge Function retorna; antes
  // disso exibimos a estimativa (mesma conta que StepReview já mostrou).
  const totalPrice = pix.phase === 'waiting' ? pix.total_price : savedTotalPrice ?? estimateTotal(store)
  // store.gameId/serviceId começam como slug cru ('lol', 'win_boost') até
  // OrderBuilder.tsx resolver os uuids reais em segundo plano -- clicar
  // antes disso mandaria o slug pro backend, que rejeita (.uuid()).
  const catalogReady = isUuid(store.gameId ?? '') && isUuid(store.serviceId ?? '')

  function startNewOrder() {
    stopQrRetry(qrRetryTimeoutRef)
    store.reset()
    store.setStep('service')
    setSavedOrderId(null)
    setSavedTotalPrice(null)
    setSaveError(null)
    setPix({ phase: 'idle' })
    setMethod(null)
    setCardAcceptance(null)
    idempotencyKeyRef.current = crypto.randomUUID()
    expiryHandledRef.current = false
    setSearchParams({ new: '1' }, { replace: true })
  }

  const { remaining, countdownLabel } = usePixExpiry({ pix, setPix, resetStore, navigate, queryClient, expiryHandledRef, startNewOrder })
  usePaymentWatch({ pix, method, cardAcceptance, savedOrderId, setPix, setCardAcceptance, resetStore, navigate })
  useEffect(() => () => { stopQrRetry(qrRetryTimeoutRef) }, [])
  useRestoreOrder({
    profile, pendingOrderId, restoredOrderRef, idempotencyKeyRef, setSavedOrderId,
    setSavedTotalPrice, setSaveError, setRestoreDone, navigate, setSearchParams,
  })

  // "Cancelar" precisa realmente liberar o pedido no servidor, não só sair da tela.
  async function handleCancelOrder() {
    if (pix.phase !== 'waiting' || isCancelling) return
    const orderId = pix.order_id
    setIsCancelling(true)

    try {
      await cancelPendingOrder(orderId)
    } catch {
      if (await redirectIfPaid(orderId, ctx)) return
    } finally {
      setIsCancelling(false)
    }

    invalidateOrderLists(queryClient)
    startNewOrder()
  }

  async function persistPendingOrder(): Promise<string | null> {
    if (!profile || !catalogReady || !addonsReady) return null
    if (savedOrderId) return savedOrderId

    setIsSavingOrder(true)
    setSaveError(null)
    try {
      const saved = await savePendingOrderFromIntent({
        intent: buildOrderIntent(store, addonCodes, flow),
        idempotencyKey: idempotencyKeyRef.current,
        preferredBoosterId: store.preferredBoosterId ?? undefined,
      })
      restoredOrderRef.current = saved.order_id
      setSavedOrderId(saved.order_id)
      setSavedTotalPrice(Number(saved.total_price))
      setSearchParams({ order: saved.order_id }, { replace: true })
      invalidateOrderLists(queryClient)
      return saved.order_id
    } catch (err) {
      setSaveError(pixErrorMessage(err))
      return null
    } finally {
      setIsSavingOrder(false)
    }
  }

  // O pedido só é criado quando o cliente escolhe a forma de pagamento --
  // nunca automaticamente ao entrar nesta etapa (evita pedidos órfãos).
  async function generatePix() {
    if (!profile || generatingRef.current) return

    if (!catalogReady) {
      setPix({ phase: 'error', message: 'Ainda carregando o catálogo — aguarde um instante e tente novamente.' })
      return
    }

    generatingRef.current = true
    try {
      const erroredOrderId = pix.phase === 'error' ? pix.order_id : undefined
      const orderId = erroredOrderId ?? savedOrderId ?? pendingOrderId ?? await persistPendingOrder()
      if (!orderId) { setMethod(null); return }
      setPix({ phase: 'generating' })
      await invokePix(orderId, ctx)
    } catch (err) {
      setPix({ phase: 'error', message: err instanceof Error ? err.message : 'Erro desconhecido' })
    } finally {
      generatingRef.current = false
    }
  }

  // PIX segue direto para a cobrança; cartão só libera o formulário depois do pedido salvo.
  async function chooseMethod(next: PaymentMethod) {
    if (!profile || generatingRef.current) return
    setPix({ phase: 'idle' })
    setMethod(next)
    if (next === 'pix') return generatePix()

    generatingRef.current = true
    try {
      const orderId = savedOrderId ?? pendingOrderId ?? await persistPendingOrder()
      if (!orderId) setMethod(null)
    } finally {
      generatingRef.current = false
    }
  }

  return {
    pix, method, setMethod, cardAcceptance, setCardAcceptance, isSavingOrder, restoreDone, saveError,
    savedOrderId, pendingOrderId, totalPrice, catalogReady, addonsReady, remaining, countdownLabel,
    isCancelling, handleCancelOrder, chooseMethod,
  }
}
