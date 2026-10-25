import { lazy, Suspense } from 'react'
import { ChevronLeft, Loader2, XCircle } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { CardAnalysisNotice } from '@/components/order/CardAnalysisNotice'
import { PaymentMethodPicker } from '@/components/order/PaymentMethodPicker'
import { PixWaitingPanel } from '@/components/order/PixWaitingPanel'
import { useOrderPaymentInfo } from '@/api/orders'
import { isCardPaymentInAnalysis } from '@/lib/orderPayment'
import type { Order } from '@/types'
import { usePendingPayment } from './usePendingPayment'

// O SDK do Mercado Pago só carrega se o cliente escolher cartão.
const CardPaymentPanel = lazy(() => import('@/components/order/CardPaymentPanel').then((m) => ({ default: m.CardPaymentPanel })))

type PendingPayment = ReturnType<typeof usePendingPayment>

function MethodChoice({ pay }: { pay: PendingPayment }) {
  return (
    <div className="space-y-4">
      <PaymentMethodPicker
        onSelect={(next) => (next === 'card' ? pay.setMethod('card') : pay.loadPix())}
        disabled={pay.isGeneratingPix}
      />
      <ActionBar>
        <Button variant="secondary" loading={pay.isCancelling} disabled={pay.isGeneratingPix} onClick={pay.cancelOrder} leftIcon={<XCircle className="h-4 w-4" />}>
          Cancelar pedido
        </Button>
      </ActionBar>
      {pay.isGeneratingPix && (
        <p className="flex items-center justify-center gap-2 text-sm text-ink-secondary" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-brand" /> Gerando seu PIX…
        </p>
      )}
    </div>
  )
}

function CardMethod({ order, pay }: { order: Order; pay: PendingPayment }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => pay.setMethod(null)} leftIcon={<ChevronLeft className="h-4 w-4" />}>
        Trocar forma de pagamento
      </Button>
      <Suspense fallback={<Loader2 className="mx-auto my-10 h-8 w-8 animate-spin text-brand" />}>
        <CardPaymentPanel orderId={order.id} totalPrice={Number(order.total_price)} onAccepted={pay.setCardAcceptance} />
      </Suspense>
    </div>
  )
}

function PixMethod({ pay, pix }: { pay: PendingPayment; pix: NonNullable<PendingPayment['pix']> }) {
  if (pay.remaining === 0) {
    return (
      <div className="space-y-3 max-w-md">
        <ErrorAlert message="PIX expirado. Cancelando o pedido…" />
        <Button variant="danger" loading={pay.isCancelling} onClick={pay.cancelOrder} leftIcon={<XCircle className="h-4 w-4" />}>
          Cancelar pedido
        </Button>
      </div>
    )
  }
  return (
    <PixWaitingPanel
      totalPrice={Number(pix.total_price)}
      qrCode={pix.qr_code ?? ''}
      qrCodeBase64={pix.qr_code_base64 ?? null}
      remaining={pay.remaining}
      countdownLabel={pay.label}
      copied={pay.copied}
      copyError={pay.copyError}
      onCopy={pay.copyPix}
      onCancel={pay.cancelOrder}
      cancelling={pay.isCancelling}
    />
  )
}

function PaymentBody({ order, pay, cardInAnalysis, close }: { order: Order; pay: PendingPayment; cardInAnalysis: boolean; close: () => void }) {
  if (pay.cardAcceptance === 'approved') {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
        <p className="text-sm font-medium text-ink-secondary">Pagamento aprovado! Confirmando seu pedido…</p>
      </div>
    )
  }
  if (cardInAnalysis) return <CardAnalysisNotice actionLabel="Fechar" onAction={close} />
  if (pay.method === 'card') return <CardMethod order={order} pay={pay} />
  if (!pay.pix) return <MethodChoice pay={pay} />
  return <PixMethod pay={pay} pix={pay.pix} />
}

interface PendingPaymentSectionProps {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PendingPaymentSection({ order, open, onOpenChange }: PendingPaymentSectionProps) {
  const pay = usePendingPayment(order, () => onOpenChange(false))
  const { data: paymentInfo } = useOrderPaymentInfo(order.id, order.status === 'awaiting_payment')
  const cardInAnalysis = pay.cardAcceptance === 'pending' || isCardPaymentInAnalysis(paymentInfo)

  if (order.status !== 'awaiting_payment') return null

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Pagamento"
      description="Pedido ainda não pago. Escolha a forma de pagamento para continuar ou cancele o pedido."
      maxWidth="md"
    >
      <PaymentBody order={order} pay={pay} cardInAnalysis={cardInAnalysis} close={() => onOpenChange(false)} />
      {pay.error && <div className="mt-3"><ErrorAlert message={pay.error} /></div>}
    </Modal>
  )
}
