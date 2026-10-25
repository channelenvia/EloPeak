import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { NavigateFunction, SetURLSearchParams } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import { isPaymentConfirmed } from '@/lib/orderPayment'
import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import { queryKeys } from '@/api/core/queryKeys'
import { getCustomerOrderState, generatePix as generatePixRequest } from '@/api/orders'
import {
  buildWaitingState, fallbackOrderIdOf, isDeadOrderError, orderDetailPath, withRetriedQr,
  type PixState,
} from './paymentTypes'

const QR_RETRY_DELAY_MS = 3000
const CANCEL_TIMEOUT_MS = 20_000
const DEAD_ORDER_MESSAGE = 'Pagamento indisponível para este pedido. Clique em "Gerar PIX" para tentar de novo.'

export interface PaidRedirectContext {
  setPix: Dispatch<SetStateAction<PixState>>
  resetStore: () => void
  navigate: NavigateFunction
}

export interface PixContext extends PaidRedirectContext {
  queryClient: QueryClient
  setSearchParams: SetURLSearchParams
  setSavedOrderId: Dispatch<SetStateAction<string | null>>
  setSavedTotalPrice: Dispatch<SetStateAction<number | null>>
  setCardAcceptance: Dispatch<SetStateAction<CardPaymentAcceptance | null>>
  idempotencyKeyRef: MutableRefObject<string>
  qrRetryTimeoutRef: MutableRefObject<number | null>
}

export function stopQrRetry(ref: MutableRefObject<number | null>) {
  if (ref.current === null) return
  clearTimeout(ref.current)
  ref.current = null
}

export function invalidateOrderLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.orders.customerScope })
  queryClient.invalidateQueries({ queryKey: queryKeys.resumableOrder.all })
}

// Cancela o pedido pendente no servidor (mesma edge function para expiração e "Cancelar").
export function cancelPendingOrder(orderId: string) {
  return invokeEdgeFunction('cancel-pending-order', {
    body: { order_id: orderId },
    timeoutMs: CANCEL_TIMEOUT_MS,
    requireAuth: true,
  })
}

export function confirmAndRedirect(orderId: string, requiresCredentials: boolean, ctx: PaidRedirectContext) {
  ctx.setPix({ phase: 'confirmed' })
  ctx.resetStore()
  ctx.navigate(orderDetailPath(orderId, requiresCredentials), { replace: true })
}

// Uma confirmação pode chegar bem na hora do cancelamento/expiração -- nunca
// descarta um pagamento que o backend já marcou como aprovado.
export async function redirectIfPaid(orderId: string, ctx: PaidRedirectContext): Promise<boolean> {
  const state = await getCustomerOrderState(orderId).catch(() => null)
  if (!isPaymentConfirmed(state)) return false
  confirmAndRedirect(orderId, state?.requires_credentials === true, ctx)
  return true
}

async function handleInvokeError(err: unknown, orderId: string, ctx: PixContext) {
  // MP já aprovou o pagamento mas o webhook ainda não chegou -- corrida de
  // tempo, não erro real. Redireciona igual a payment_confirmed.
  if (err instanceof EdgeFunctionError && err.code === 'ALREADY_PAID') {
    const state = await getCustomerOrderState(orderId).catch(() => null)
    confirmAndRedirect(orderId, state?.requires_credentials === true, ctx)
    return
  }

  // Já existe um cartão em análise para este pedido: não há QR a gerar,
  // só esperar o provedor (o polling segue acompanhando).
  if (err instanceof EdgeFunctionError && err.code === 'CARD_PAYMENT_PENDING') {
    ctx.setSavedOrderId(orderId)
    ctx.setCardAcceptance('pending')
    return
  }

  // Limpa a vinculação (mantém a config no store) pro próximo "Gerar PIX"
  // criar um pedido novo, em vez de travar tentando o mesmo morto.
  if (isDeadOrderError(err)) {
    ctx.setSavedOrderId(null)
    ctx.setSavedTotalPrice(null)
    ctx.setSearchParams({}, { replace: true })
    // Sem isso, o idempotency_key antigo ainda aponta (server-side) pro MESMO
    // order_id morto e o retry bateria no mesmo 400 pra sempre.
    ctx.idempotencyKeyRef.current = crypto.randomUUID()
    ctx.setPix({ phase: 'error', message: DEAD_ORDER_MESSAGE })
    return
  }

  ctx.setPix({ phase: 'error', message: pixErrorMessage(err), order_id: fallbackOrderIdOf(err) })
}

// If MP didn't return base64 yet, retry once after 3s to get it. Scoped to
// this order (tracked in a ref, cancelled on unmount/next invokePix).
function scheduleQrRetry(orderId: string, ctx: PixContext) {
  ctx.qrRetryTimeoutRef.current = window.setTimeout(async () => {
    const retry = await generatePixRequest(orderId).catch(() => null)
    if (!retry?.qr_code_base64) return
    const qrBase64 = retry.qr_code_base64
    ctx.setPix((prev) => withRetriedQr(prev, orderId, qrBase64))
  }, QR_RETRY_DELAY_MS)
}

// Chama a Edge Function que cria (ou reaproveita) o pedido e gera o PIX.
// O preço nunca é enviado pelo cliente — a function recomputa tudo.
export async function invokePix(orderId: string, ctx: PixContext) {
  let pixData: Awaited<ReturnType<typeof generatePixRequest>>
  try {
    pixData = await generatePixRequest(orderId)
  } catch (err) {
    await handleInvokeError(err, orderId, ctx)
    return
  }

  if (!pixData.qr_code) {
    ctx.setPix({ phase: 'error', message: 'A função não retornou o código PIX. Tente novamente.', order_id: pixData.order_id })
    return
  }

  ctx.setPix(buildWaitingState(pixData, orderId, pixData.qr_code))
  ctx.setSearchParams({ order: orderId }, { replace: true })
  invalidateOrderLists(ctx.queryClient)

  stopQrRetry(ctx.qrRetryTimeoutRef)
  if (!pixData.qr_code_base64) scheduleQrRetry(orderId, ctx)
}
