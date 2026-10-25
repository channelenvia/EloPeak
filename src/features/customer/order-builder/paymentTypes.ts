import type { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { getBoostFlow } from '@/lib/boostDomain'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { applyCoupon } from '@/lib/pricing'
import type { PixPaymentResponse } from '@/api/orders'

export type PixWaitingState = {
  phase: 'waiting'
  qr_code: string
  qr_base64: string | null
  expires_at: string
  server_offset_ms: number
  payment_id: string
  order_id: string
  total_price: number
}

// PIX states
export type PixState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | PixWaitingState
  | { phase: 'confirmed' }
  | { phase: 'expired'; order_id: string }
  | { phase: 'error'; message: string; order_id?: string }

type OrderBuilderSnapshot = ReturnType<typeof useOrderBuilderStore.getState>

export type PaymentStore = Pick<
  OrderBuilderSnapshot,
  | 'basePrice' | 'boostMode' | 'clashDay' | 'clashTier' | 'couponCode' | 'currentLp' | 'currentPdl'
  | 'currentRank' | 'customerLanes' | 'customerNotes' | 'extrasPrice' | 'gameId' | 'preferredBoosterId'
  | 'prevStep' | 'queueType' | 'reset' | 'riotId' | 'rankDeclared' | 'selectedCoachPackage'
  | 'selectedExtraIds' | 'server' | 'serviceId' | 'serviceType' | 'sessionsPurchased' | 'setStep'
  | 'targetRank' | 'winPackage' | 'winsPurchased'
>

export type BoostFlow = ReturnType<typeof getBoostFlow> | null

export function orderDetailPath(orderId: string, requiresCredentials: boolean): string {
  return `/orders/${orderId}${requiresCredentials ? '#credentials' : ''}`
}

export function buildWaitingState(pixData: PixPaymentResponse, orderId: string, qrCode: string): PixWaitingState {
  return {
    phase: 'waiting',
    qr_code: qrCode,
    qr_base64: pixData.qr_code_base64 ?? null,
    expires_at: pixData.expires_at,
    server_offset_ms: pixData.server_time ? new Date(pixData.server_time).getTime() - Date.now() : 0,
    payment_id: String(pixData.payment_id),
    order_id: orderId,
    total_price: Number(pixData.total_price),
  }
}

// Só aplica o base64 retornado no retry se a UI ainda espera ESTE mesmo pedido.
export function withRetriedQr(prev: PixState, orderId: string, qrBase64: string | null): PixState {
  return prev.phase === 'waiting' && prev.order_id === orderId ? { ...prev, qr_base64: qrBase64 } : prev
}

export function estimateTotal(store: PaymentStore): number {
  const subtotal = store.basePrice + store.extrasPrice
  const coupon = store.couponCode && store.serviceType
    ? applyCoupon(subtotal, store.couponCode, store.serviceType)
    : null
  return subtotal - (coupon?.couponApplied ? coupon.discountPrice : 0)
}

// Clash reaproveita o mesmo catálogo do Elo Boost (ver StepExtras.tsx):
// Solo Clash usa 'solo_standard', Duo Clash usa 'duo_standard'.
export function resolveFlow(store: PaymentStore): BoostFlow {
  if (store.serviceType === 'elo_boost' && store.currentRank) {
    return getBoostFlow(store.currentRank.tier, store.boostMode, store.queueType)
  }
  const usesStandardFlow = store.serviceType === 'win_boost' || store.serviceType === 'md5' || store.serviceType === 'clash'
  if (!usesStandardFlow) return null
  return store.boostMode === 'duo' ? 'duo_standard' : 'solo_standard'
}

// Pedido morto -- não existe mais (404) ou não pode mais receber pagamento
// (400 "not awaiting payment", ex.: PIX recusado no MP).
export function isDeadOrderError(err: unknown): boolean {
  return err instanceof EdgeFunctionError
    && (err.status === 404 || (err.status === 400 && /not awaiting payment/i.test(err.message)))
}

export function fallbackOrderIdOf(err: unknown): string | undefined {
  if (!(err instanceof EdgeFunctionError) || !err.body || typeof err.body === 'string') return undefined
  return typeof err.body.order_id === 'string' ? err.body.order_id : undefined
}
