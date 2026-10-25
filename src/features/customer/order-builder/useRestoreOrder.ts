import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { NavigateFunction, SetURLSearchParams } from 'react-router-dom'
import { isPaymentConfirmed } from '@/lib/orderPayment'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import { getCustomerOrderState } from '@/api/orders'
import { useLatestRef } from './useLatestRef'
import { orderDetailPath } from './paymentTypes'

interface Params {
  profile: unknown
  pendingOrderId: string | null
  restoredOrderRef: MutableRefObject<string | null>
  idempotencyKeyRef: MutableRefObject<string>
  setSavedOrderId: Dispatch<SetStateAction<string | null>>
  setSavedTotalPrice: Dispatch<SetStateAction<number | null>>
  setSaveError: Dispatch<SetStateAction<string | null>>
  setRestoreDone: Dispatch<SetStateAction<boolean>>
  navigate: NavigateFunction
  setSearchParams: SetURLSearchParams
}

// Ao voltar com um pedido já criado, valida apenas se ele ainda pode ser
// pago. Nunca gera nem reexibe o QR automaticamente; isso fica reservado
// ao clique em "Gerar PIX".
export function useRestoreOrder(params: Params) {
  const { profile, pendingOrderId, restoredOrderRef, idempotencyKeyRef, setSavedOrderId, setSavedTotalPrice, setSaveError, setRestoreDone } = params
  // navigate/setSearchParams mudam de identidade a cada navegação; o efeito
  // só deve rodar na chegada do pendingOrderId (guard restoredOrderRef).
  const latest = useLatestRef(params)

  useEffect(() => {
    if (!profile || !pendingOrderId || restoredOrderRef.current === pendingOrderId) return
    restoredOrderRef.current = pendingOrderId
    setSavedOrderId(pendingOrderId)
    const { navigate, setSearchParams } = latest.current

    void (async () => {
      const state = await getCustomerOrderState(pendingOrderId).catch(() => null)
      if (isPaymentConfirmed(state)) {
        navigate(orderDetailPath(pendingOrderId, state?.requires_credentials === true), { replace: true })
        return
      }
      // Pedido morto (state null, ou can_pay false -- cancelado/recusado/
      // expirado) -- nunca insiste em gerar PIX pra ele. Solta a vinculação
      // e gera uma idempotency key nova, senão o próximo
      // persistPendingOrder() reencontraria e reusaria o mesmo pedido morto.
      if (!state?.can_pay) {
        setSavedOrderId(null)
        setSavedTotalPrice(null)
        setSearchParams({}, { replace: true })
        idempotencyKeyRef.current = crypto.randomUUID()
        setSaveError('Pagamento indisponível para este pedido. Clique em "Gerar PIX" para configurar de novo.')
      }
    })().catch((err) => {
      setSaveError(pixErrorMessage(err))
    }).finally(() => {
      setRestoreDone(true)
    })
  }, [pendingOrderId, profile, latest, restoredOrderRef, idempotencyKeyRef, setSavedOrderId, setSavedTotalPrice, setSaveError, setRestoreDone])
}
