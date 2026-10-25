import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ChevronLeft } from 'lucide-react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { Button } from '@/components/ui'
import { PixWaitingPanel } from '@/components/order/PixWaitingPanel'
import { CardAnalysisNotice } from '@/components/order/CardAnalysisNotice'
import { CenteredStatus, PaymentConfirmed, PixExpired } from './PaymentStatusViews'
import { PaymentMethodStep } from './PaymentMethodStep'
import { usePixPayment } from './usePixPayment'
import { useCopyCode } from './useCopyCode'

// O SDK do Mercado Pago só carrega se o cliente escolher cartão.
const CardPaymentPanel = lazy(() => import('@/components/order/CardPaymentPanel').then((m) => ({ default: m.CardPaymentPanel })))

export function StepPayment({ insideModal = false }: { insideModal?: boolean } = {}) {
  // Seletor direcionado (useShallow) -- StepPayment abre como modal por cima
  // de StepReview, os dois montados ao mesmo tempo; sem seletor, digitar em
  // StepReview (ex.: customerNotes) re-renderizava StepPayment inteiro.
  const store = useOrderBuilderStore(useShallow((s) => ({
    basePrice: s.basePrice,
    boostMode: s.boostMode,
    clashDay: s.clashDay,
    clashTier: s.clashTier,
    couponCode: s.couponCode,
    currentLp: s.currentLp,
    currentPdl: s.currentPdl,
    currentRank: s.currentRank,
    customerLanes: s.customerLanes,
    customerNotes: s.customerNotes,
    extrasPrice: s.extrasPrice,
    gameId: s.gameId,
    preferredBoosterId: s.preferredBoosterId,
    prevStep: s.prevStep,
    queueType: s.queueType,
    reset: s.reset,
    riotId: s.riotId,
    rankDeclared: s.rankDeclared,
    selectedCoachPackage: s.selectedCoachPackage,
    selectedExtraIds: s.selectedExtraIds,
    server: s.server,
    serviceId: s.serviceId,
    serviceType: s.serviceType,
    sessionsPurchased: s.sessionsPurchased,
    setStep: s.setStep,
    targetRank: s.targetRank,
    winPackage: s.winPackage,
    winsPurchased: s.winsPurchased,
  })))
  const navigate = useNavigate()
  const payment = usePixPayment(store)
  const { copied, copyError, copy } = useCopyCode()
  const { pix, method, cardAcceptance, totalPrice } = payment

  if (pix.phase === 'confirmed') return <PaymentConfirmed />
  if (pix.phase === 'expired') return <PixExpired />

  if (pix.phase === 'waiting') {
    return (
      <PixWaitingPanel
        totalPrice={totalPrice}
        qrCode={pix.qr_code}
        qrCodeBase64={pix.qr_base64}
        remaining={payment.remaining}
        countdownLabel={payment.countdownLabel}
        copied={copied}
        copyError={copyError}
        onCopy={() => copy(pix.qr_code)}
        onCancel={payment.handleCancelOrder}
        cancelling={payment.isCancelling}
      />
    )
  }

  // Salvando o pedido (ou conferindo o já salvo)
  if (payment.isSavingOrder) return <CenteredStatus label="Salvando…" />
  if (!payment.restoreDone) return <CenteredStatus label="Verificando seu pedido…" />

  // Cartão aceito: aprovado confirma sozinho; em análise espera o provedor
  if (cardAcceptance === 'approved') return <CenteredStatus label="Pagamento aprovado! Confirmando seu pedido…" />
  if (cardAcceptance === 'pending') {
    return <CardAnalysisNotice actionLabel="Ver meus pedidos" onAction={() => navigate('/orders')} />
  }

  // Cartão: formulário liberado depois do pedido salvo
  const cardOrderId = payment.savedOrderId ?? payment.pendingOrderId
  if (method === 'card' && cardOrderId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => payment.setMethod(null)} leftIcon={<ChevronLeft className="h-4 w-4" />}>
          Trocar forma de pagamento
        </Button>
        <Suspense fallback={<CenteredStatus label="Carregando formulário…" />}>
          <CardPaymentPanel orderId={cardOrderId} totalPrice={totalPrice} onAccepted={payment.setCardAcceptance} />
        </Suspense>
      </div>
    )
  }

  if (pix.phase === 'generating') return <CenteredStatus label="Gerando seu PIX…" />

  return (
    <PaymentMethodStep
      insideModal={insideModal}
      totalPrice={totalPrice}
      disabled={totalPrice <= 0 || !payment.catalogReady || !payment.addonsReady}
      pixErrorMessage={pix.phase === 'error' ? pix.message : null}
      saveError={payment.saveError}
      onSelect={payment.chooseMethod}
      onBack={store.prevStep}
    />
  )
}
