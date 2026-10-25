import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { queryKeys } from '@/api/core/queryKeys'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import type { BuilderParams } from './useBuilderParams'

const CANCEL_PENDING_ORDER_TIMEOUT_MS = 20_000

// Estado e ações de saída do configurador: popup de pagamento, confirmação de
// saída do popup e confirmação de "Reiniciar".
export function useOrderBuilderExit(params: Pick<BuilderParams, 'pendingOrderId' | 'searchParams' | 'setSearchParams'>) {
  const { pendingOrderId, searchParams, setSearchParams } = params
  const queryClient = useQueryClient()
  const { prevStep, reset, setStep, setDismissedOrderId } = useOrderBuilderStore()
  // Pagamento é um popup sobre a revisão. Fecha sozinho ao sair de 'review' (efeito na página).
  const [pixModalOpen, setPixModalOpen] = useState(false)
  // Confirma antes de fechar o popup com um pedido já persistido (?order= setado por "Gerar PIX").
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [showRestartConfirm, setShowRestartConfirm] = useState(false)

  // "Voltar" na revisão cancela no servidor o pedido já persistido (fire-and-forget,
  // nunca trava a navegação) antes de sair.
  function goBackFromReview() {
    const orderId = searchParams.get('order')
    if (orderId) {
      // Sem isso o auto-resume reabria este mesmo pedido enquanto o cancelamento ainda nao refletia no cache (H-8).
      setDismissedOrderId(orderId)
      void invokeEdgeFunction('cancel-pending-order', {
        body: { order_id: orderId },
        timeoutMs: CANCEL_PENDING_ORDER_TIMEOUT_MS,
        requireAuth: true,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.customerScope })
        queryClient.invalidateQueries({ queryKey: queryKeys.resumableOrder.all })
      }).catch(() => {})
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('order')
        return next
      }, { replace: true })
    }
    prevStep()
  }

  // Radix chama onOpenChange(false) pra qualquer tentativa de fechar. Sem pedido
  // persistido, fecha direto.
  function handlePixModalOpenChange(open: boolean) {
    if (open) { setPixModalOpen(true); return }
    if (!pendingOrderId) { setPixModalOpen(false); return }
    setShowExitConfirm(true)
  }

  // Nunca cancela o pedido -- continua pagável em Meus Pedidos. Só desvincula o
  // configurador local dele.
  function confirmExitPixModal() {
    const orderId = pendingOrderId
    setShowExitConfirm(false)
    setPixModalOpen(false)
    reset()
    // Depois do reset() (que reaplicaria dismissedOrderId = null).
    if (orderId) setDismissedOrderId(orderId)
    setStep('service')
    setSearchParams({ new: '1' }, { replace: true })
  }

  function confirmRestart() {
    setShowRestartConfirm(false)
    confirmExitPixModal()
  }

  return {
    pixModalOpen, setPixModalOpen, showExitConfirm, setShowExitConfirm, showRestartConfirm, setShowRestartConfirm,
    goBackFromReview, handlePixModalOpenChange, confirmExitPixModal, confirmRestart,
  }
}
