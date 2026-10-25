import { useEffect, type MutableRefObject } from 'react'
import { useCountdown } from '@/hooks/useCountdown'
import { invalidateOrderLists, cancelPendingOrder, redirectIfPaid, type PaidRedirectContext } from './pixActions'
import { useLatestRef } from './useLatestRef'
import type { PixState } from './paymentTypes'
import type { QueryClient } from '@tanstack/react-query'

interface Params extends PaidRedirectContext {
  pix: PixState
  queryClient: QueryClient
  expiryHandledRef: MutableRefObject<boolean>
  startNewOrder: () => void
}

// At the provider expiration timestamp, cancel/delete the unpaid checkout
// through the authenticated backend and return the configurator to step 1.
export function usePixExpiry(params: Params) {
  const { pix, expiryHandledRef } = params
  const expiresAt = pix.phase === 'waiting' ? pix.expires_at : null
  const { remaining, label: countdownLabel } = useCountdown(expiresAt, pix.phase === 'waiting' ? pix.server_offset_ms : 0)
  const latest = useLatestRef(params)
  const phase = pix.phase

  useEffect(() => {
    const { pix: current, setPix, resetStore, navigate, queryClient, startNewOrder } = latest.current
    if (current.phase !== 'waiting' || remaining !== 0 || expiryHandledRef.current) return
    expiryHandledRef.current = true
    const orderId = current.order_id
    setPix({ phase: 'expired', order_id: orderId })

    void cancelPendingOrder(orderId)
      .catch(() => redirectIfPaid(orderId, { setPix, resetStore, navigate }))
      .then((paymentConfirmed) => {
        if (paymentConfirmed === true) return
        invalidateOrderLists(queryClient)
        startNewOrder()
      })
  }, [remaining, phase, latest, expiryHandledRef])

  return { remaining, countdownLabel }
}
