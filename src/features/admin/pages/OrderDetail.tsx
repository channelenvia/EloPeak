import { useBoosterServiceDetails } from '@/api/coaching'
import { Badge } from '@/components/ui/Badge'
import { useOrderParties } from '@/api/admin'
import { useOrder, useOrderPaidAmount, useOrderPaymentInfo, useOrderStatusHistory, useSyncOrderMatches } from '@/api/orders'
import { isCardPaymentInAnalysis } from '@/lib/orderPayment'
import { AccessTokenSection } from '@/components/order/AccessTokenSection'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { DuoAccountHistoryList } from '@/components/order/DuoAccountHistoryList'
import { DuoPartnerRiotId } from '@/components/order/DuoPartnerRiotId'
import { OrderDetailShell } from '@/components/order/OrderDetailShell'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import type { OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { Button, ErrorAlert, OrderStatusBadge, PageLoader } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { formatDateTime, formatEstimatedDelivery, getOrderServiceName, orderRequiresAccountAccess, timeAgo } from '@/lib/utils'
import { CalendarDays, Check, Clock, Copy, Gamepad2, Hash, History, Route, Shuffle, User, Users, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AdminStatusActionsMenu } from '../components/AdminStatusActionsMenu'
import { AdminDropModal, PendingReviewAssignModal } from '../components/AdminOrderModals'
import { DROPPABLE_STATUSES } from '../components/adminOrderActions'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'

type BoosterRef = { id: string; user_id: string; display_name: string } | undefined

function BoosterLink({ userId, booster }: { userId: string; booster: BoosterRef }) {
  if (!booster) return <span className="font-mono text-xs">{userId.slice(0, 8)}…</span>
  return (
    <Link to={`/admin/boosters/${booster.id}`} className="text-brand hover:underline">
      {booster.display_name}
    </Link>
  )
}


export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [assignOpen, setAssignOpen] = useState(false)
  const currency = useCurrency()
  const [nickCopied, setNickCopied] = useState(false)
  const [dropModalOpen, setDropModalOpen] = useState(false)

  const { data: order, isLoading: loadingOrder, isError: orderError, refetch: refetchOrder } = useOrder(id)
  const { data: paymentInfo } = useOrderPaymentInfo(order?.id, order?.status === 'awaiting_payment')
  const { data: paidAmount } = useOrderPaidAmount(id)
  const { data: history } = useOrderStatusHistory(id)
  const { data: coachPackage } = useBoosterServiceDetails(order?.booster_service_id ?? undefined)

  const { data: parties } = useOrderParties(order?.customer_id, order?.assigned_booster_id, order?.preferred_booster_id)

  const syncMatches = useSyncOrderMatches(id ?? '')

  if (loadingOrder) return <PageLoader />

  if (orderError) {
    return (
      <div className="space-y-4">
        <ErrorAlert message="Não foi possível carregar o pedido. Tente novamente." />
        <Button onClick={() => refetchOrder()}>Tentar novamente</Button>
      </div>
    )
  }

  if (!order) return null

  const { isBoostFlow, isClash, modeLabel, clashClosingLabel } = getOrderDetailInfo(order)

  async function copyNickname() {
    if (!order?.riot_id) return
    await navigator.clipboard.writeText(order.riot_id)
    setNickCopied(true)
    setTimeout(() => setNickCopied(false), 1500)
  }

  const dropVisible = DROPPABLE_STATUSES.includes(order.status)

  const infoItems: OrderInfoGridItem[] = [
    { icon: Gamepad2, label: 'Serviço', value: getOrderServiceName(order) },
    ...((isBoostFlow || isClash) ? [{ icon: Shuffle, label: 'Modo do pedido', value: modeLabel }] : []),
    ...(isBoostFlow
      ? [{ icon: Users, label: 'Fila', value: order.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex' }]
      : isClash && order.clash_day
        ? [{ icon: Users, label: 'Dia', value: (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day!)
            return `${day}/${month} · ${CLASH_DAY_LABEL[order.clash_day!]}`
          })() }]
        : []),
    ...(order.service_type === 'coaching' && order.sessions_purchased != null
      ? [{ icon: CalendarDays, label: 'Sessões', value: `${order.sessions_purchased}` }]
      : []),
    { icon: User, label: 'Cliente', value: parties?.customerUsername ?? 'Carregando…' },
    ...((isBoostFlow || isClash) && order.riot_id ? [{
      icon: Hash, label: 'Riot ID', value: (
        <span className="inline-flex items-center justify-center gap-1.5">
          {order.riot_id}
          <button type="button" onClick={() => void copyNickname()} aria-label="Copiar Riot ID" className="text-ink-muted hover:text-brand transition-colors">
            {nickCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </span>
      ),
    }] : []),
    ...getLaneDisplayItems(order, 'admin')
      .filter((item) => item.lanes.length > 0)
      .map((item) => ({ icon: Route, label: item.label, value: <ServiceTagPills lanes={item.lanes} allLabel={item.allLabel} compact className="justify-center" /> })),
    ...(() => {
      const boosterId = order.assigned_booster_id ?? order.preferred_booster_id
      if (!boosterId) return []
      return [{
        icon: User, label: 'Booster associado', value: (
          <span className="inline-flex items-center gap-1.5">
            <BoosterLink userId={boosterId} booster={parties?.boosterByUserId.get(boosterId)} />
            {!order.assigned_booster_id && (
              <span className={`text-2xs font-bold uppercase ${order.reassigned_by_admin ? 'text-rank-master' : 'text-accent'}`}>
                {order.reassigned_by_admin ? 'Reatribuído' : 'Exclusivo'}
              </span>
            )}
          </span>
        ),
      }]
    })(),
    { icon: Clock, label: 'Entrega estimada', value: isClash ? clashClosingLabel : (order.estimated_hours ? formatEstimatedDelivery(order.estimated_hours) : 'Não disponível') },
    { icon: Wallet, label: 'Total pago', value: currency(paidAmount ?? order.total_price) },
  ]

  const statusAction =
    order.status === 'drop_requested' ? { label: 'Clique para analisar a solicitação', run: () => navigate('/admin/drops') }
    : order.status === 'pending_review' ? { label: 'Clique para atribuir um booster', run: () => setAssignOpen(true) }
    : null

  return (
    <div className="space-y-6">
      <PendingReviewAssignModal order={order} open={assignOpen} onClose={() => setAssignOpen(false)} />
      <OrderPageHeader
        backHref="/admin/orders"
        orderIdShort={order.id.slice(0, 8).toUpperCase()}
        statusBadge={(
          <OrderStatusBadge
            order={order}
            viewerRole="admin"
            paymentInAnalysis={isCardPaymentInAnalysis(paymentInfo)}
            onAction={statusAction?.run}
            actionLabel={statusAction?.label}
          />
        )}
        extra={(
          <>
            <span className="text-xs text-ink-muted">Criado em {formatDateTime(order.created_at)}</span>
            {order.drop_count > 0 && (
              <Badge variant="warning" size="tag">
                <History className="h-3 w-3" />
                Dropado {order.drop_count > 1 ? `${order.drop_count}x` : ''} · valor e prazo já atualizados
                {order.last_dropped_at ? ` · último drop ${timeAgo(order.last_dropped_at)}` : ''}
              </Badge>
            )}
            {['in_progress', 'paused', 'awaiting_customer'].includes(order.status) && (
              <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
            )}
          </>
        )}
        onDrop={dropVisible ? () => setDropModalOpen(true) : undefined}
        dropTooltip={order.drop_count >= 2 ? 'Limite de 2 drops atingido -- confirmar aqui cancela o pedido.' : undefined}
        primary={<AdminStatusActionsMenu order={order} />}
      />

      <OrderDetailShell
        order={order}
        viewerRole="admin"
        detailsTitle="Detalhes do pedido"
        history={history}
        coachPackage={coachPackage}
        infoItems={infoItems}
        notesLabel="Notas do Cliente"
        syncMatches={syncMatches}
        accountLockedMessage={
          order.status === 'awaiting_payment'
            ? 'A conta do pedido fica disponível após a confirmação do pagamento.'
            : ['paid', 'awaiting_assignment'].includes(order.status)
              ? 'A conta fica disponível quando um booster aceitar o pedido.'
              : order.status === 'completed' && order.boost_mode !== 'duo'
                ? 'O acesso às credenciais fica bloqueado após a conclusão do pedido.'
                : !orderRequiresAccountAccess(order) && order.boost_mode !== 'duo'
                  ? 'Este serviço não exige credenciais de conta.'
                  : undefined
        }
        accountContent={
          order.boost_mode === 'duo' ? (
            ['in_progress', 'paused', 'awaiting_customer', 'completed'].includes(order.status)
              ? <DuoAccountHistoryList orderId={order.id} />
              : <DuoPartnerRiotId orderId={order.id} />
          ) : orderRequiresAccountAccess(order) ? (
            <AccessTokenSection order={order} />
          ) : null
        }
      />

      <AdminDropModal orderId={order.id} serviceType={order.service_type} dropCount={order.drop_count} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
