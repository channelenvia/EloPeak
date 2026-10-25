import { useRef, useState, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, History } from 'lucide-react'
import { OrderCompletionNotice } from '../components/OrderCompletionNotice'
import { CancellationInfo } from '../components/CancellationInfo'
import { CustomerDropModal, MAX_CUSTOMER_DROPS } from '../components/CustomerDropModal'
import { PendingPaymentSection } from '../components/PendingPaymentSection'
import { buildCustomerInfoItems } from '../components/customerOrderInfoItems'
import { getAccountLockedMessage, hasDuoAccountHistory, shouldShowCountdown, shouldShowProgress } from '../components/customerOrderRules'
import { useMarkChatReadWhenUnread, useRedirectCanceledOrder, useScrollToCredentials } from '../components/useOrderDetailEffects'
import { isCardPaymentInAnalysis } from '@/lib/orderPayment'
import { Badge } from '@/components/ui/Badge'
import { useBoosterServiceDetails } from '@/api/coaching'
import {
  useConfirmOrderCompletion,
  useCustomerOrderState,
  useOrder, useOrderPaymentInfo, useOrderStatusHistory,
  useSyncOrderMatches,
} from '@/api/orders'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { CredentialsSection } from '@/components/order/CredentialsSection'
import { DuoAccountHistoryList } from '@/components/order/DuoAccountHistoryList'
import { DuoPartnerRiotId } from '@/components/order/DuoPartnerRiotId'
import { OrderDetailShell } from '@/components/order/OrderDetailShell'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { OrderReviewSection } from '@/components/order/OrderReviewSection'
import { Button, ErrorAlert, OrderStatusBadge, Skeleton } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { formatDateTime, getOrderServiceName, getOrderStatusGroup } from '@/lib/utils'
import { describeOrderStatus, ORDER_CHAT_ANCHOR_ID } from '@/lib/orderStatusInfo'
import { useOwnReview } from '@/api/reviews'
import { useAuthStore } from '@/stores/authStore'
import type { Order } from '@/types'

type CustomerState = ReturnType<typeof useCustomerOrderState>['data']

interface StatusAction { label: string; run: () => void }

function scrollToCenter(el: Element | null | undefined) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function getStatusAction(args: {
  order: Order
  customerState: CustomerState
  reviewLoading: boolean
  hasOwnReview: boolean
  accountSectionRef: RefObject<HTMLElement | null>
  openPay: () => void
  openReview: () => void
}): StatusAction | null {
  const { order, customerState, reviewLoading, hasOwnReview } = args
  if (order.status === 'awaiting_payment') return { label: 'Clique para pagar', run: args.openPay }
  if (getOrderStatusGroup(order) === 'awaiting_credentials' && customerState?.requires_credentials) {
    return { label: 'Clique para enviar as credenciais', run: () => scrollToCenter(args.accountSectionRef.current) }
  }
  if (order.status === 'completed' && !reviewLoading && !hasOwnReview) return { label: 'Clique para avaliar', run: args.openReview }
  if (order.status === 'awaiting_customer' && order.assigned_booster_id) {
    return { label: 'Clique para abrir o chat', run: () => scrollToCenter(document.getElementById(ORDER_CHAT_ANCHOR_ID)) }
  }
  return null
}

function OrderDetailFallback({ state, onRetry, onBack }: { state: 'loading' | 'error' | 'missing'; onRetry: () => void; onBack: () => void }) {
  if (state === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="space-y-4">
        <ErrorAlert message="Não foi possível carregar o pedido. Tente novamente." />
        <Button onClick={onRetry}>Tentar novamente</Button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <ErrorAlert message="Pedido não encontrado." />
      <Button onClick={onBack}>Voltar para meus pedidos</Button>
    </div>
  )
}

function AccountContent({ order, customerState }: { order: Order; customerState: CustomerState }) {
  if (order.boost_mode !== 'duo') return <CredentialsSection order={order} state={customerState} />
  // Em 'assigned' ainda não há histórico: cai no card de "Riot ID do parceiro".
  return hasDuoAccountHistory(order.status) ? <DuoAccountHistoryList orderId={order.id} /> : <DuoPartnerRiotId orderId={order.id} />
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const currency = useCurrency()
  const { profile } = useAuthStore()
  const [dropModalOpen, setDropModalOpen] = useState(false)
  // O badge de status é o ponto de entrada das ações do pedido.
  const [payOpen, setPayOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const accountSectionRef = useRef<HTMLDivElement>(null)

  const { data: order, isLoading, isError, refetch } = useOrder(id)
  const { data: history } = useOrderStatusHistory(id)
  const { data: customerState } = useCustomerOrderState(id)
  const syncMatches = useSyncOrderMatches(id ?? '')
  const confirmCompletion = useConfirmOrderCompletion(id ?? '')
  const { data: coachPackage } = useBoosterServiceDetails(order?.booster_service_id ?? undefined)
  const { data: paymentInfo } = useOrderPaymentInfo(order?.id, order?.status === 'awaiting_payment')
  const { data: ownReview, isLoading: reviewLoading } = useOwnReview(order?.status === 'completed' ? order.id : undefined)

  useMarkChatReadWhenUnread(id, profile?.id)
  useScrollToCredentials(accountSectionRef, order, customerState?.requires_credentials)
  useRedirectCanceledOrder(order)

  if (isLoading) return <OrderDetailFallback state="loading" onRetry={refetch} onBack={() => navigate('/orders')} />
  if (isError) return <OrderDetailFallback state="error" onRetry={refetch} onBack={() => navigate('/orders')} />
  if (!order) return <OrderDetailFallback state="missing" onRetry={refetch} onBack={() => navigate('/orders')} />

  const info = getOrderDetailInfo(order)
  const infoItems = buildCustomerInfoItems(order, info, currency)
  // getOrderStatusGroup === 'in_progress' cobre assigned/in_progress/paused sempre, e awaiting_customer com booster.
  const dropVisible = getOrderStatusGroup(order) === 'in_progress'
  // 3o drop e so do admin: com o limite atingido o cliente fala com a equipe pelo chat do pedido.
  const dropLimitReached = order.drop_count >= MAX_CUSTOMER_DROPS
  const canConfirm = !!customerState?.can_confirm_completion
  const statusAction = getStatusAction({
    order, customerState, reviewLoading, hasOwnReview: !!ownReview, accountSectionRef,
    openPay: () => setPayOpen(true), openReview: () => setReviewOpen(true),
  })

  return (
    <div className="space-y-6">
      <PendingPaymentSection order={order} open={payOpen} onOpenChange={setPayOpen} />
      <OrderReviewSection order={order} open={reviewOpen} onOpenChange={setReviewOpen} />
      <OrderPageHeader
        backHref="/orders"
        orderIdShort={order.id.slice(0, 8).toUpperCase()}
        statusBadge={(
          <OrderStatusBadge
            order={order}
            viewerRole="customer"
            paymentInAnalysis={isCardPaymentInAnalysis(paymentInfo)}
            description={describeOrderStatus(order, 'customer', { reviewRating: ownReview?.rating ?? null, paymentInAnalysis: isCardPaymentInAnalysis(paymentInfo) })}
            onAction={statusAction?.run}
            actionLabel={statusAction?.label}
          />
        )}
        extra={(
          <>
            <span className="text-xs text-ink-muted">
              {getOrderServiceName(order)} · Criado {formatDateTime(order.created_at)}
            </span>
            {order.drop_count > 0 && (
              <Badge variant="warning" size="tag">
                <History className="h-3 w-3" />
                Pedido reatribuído · valor e prazo atualizados
              </Badge>
            )}
            {/* Deliberadamente NÃO usa getOrderStatusGroup(order) === 'in_progress'
                aqui -- esse grupo também inclui 'assigned', mas o contador só
                faz sentido depois que match_sync_started_at de fato existe
                (setado só ao entrar em in_progress), então 'assigned' fica de
                fora de propósito. */}
            {shouldShowCountdown(order.status) && (
              <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
            )}
          </>
        )}
        onDrop={dropVisible ? () => setDropModalOpen(true) : undefined}
        dropDisabled={dropLimitReached}
        dropTooltip="Limite de trocas atingido. Fale com a equipe pelo chat do pedido."
        primary={canConfirm ? (
          <>
            <Button variant="success" size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={confirmCompletion.isPending} onClick={() => confirmCompletion.mutate()}>
              Confirmar conclusão
            </Button>
          </>
        ) : undefined}
      />

      {canConfirm && <OrderCompletionNotice orderId={order.id} history={history} isCoaching={order.service_type === 'coaching'} />}
      <CancellationInfo order={order} />

      {confirmCompletion.isError && <ErrorAlert message={confirmCompletion.error instanceof Error ? confirmCompletion.error.message : 'Erro ao confirmar'} />}

      <OrderDetailShell
        order={order}
        viewerRole="customer"
        detailsTitle="Detalhes do Pedido"
        history={history}
        coachPackage={coachPackage}
        infoItems={infoItems}
        notesLabel="Suas Notas"
        syncMatches={syncMatches}
        accountSectionRef={accountSectionRef}
        showProgress={shouldShowProgress(order.status)}
        accountLockedMessage={getAccountLockedMessage(order, customerState)}
        accountContent={<AccountContent order={order} customerState={customerState} />}
      />

      <CustomerDropModal order={order} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
