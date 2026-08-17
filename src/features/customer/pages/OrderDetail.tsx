import { useAssignedBooster } from '@/api/boosters'
import { useMarkOrderChatRead, useOrderChat } from '@/api/chat'
import { useBoosterServiceDetails } from '@/api/coaching'
import {
    getCustomerOrderState,
    useCancelPendingOrder,
    useConfirmOrderCompletion,
    useCustomerOrderState,
    useGeneratePix,
    useOrder, useOrderStatusHistory,
    useRequestCustomerOrderDrop,
    useSyncOrderMatches,
} from '@/api/orders'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { CredentialsSection } from '@/components/order/CredentialsSection'
import { DuoAccountHistoryList } from '@/components/order/DuoAccountHistoryList'
import { DuoPartnerRiotId } from '@/components/order/DuoPartnerRiotId'
import { OrderDetailShell } from '@/components/order/OrderDetailShell'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import type { OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { OrderReviewSection } from '@/components/order/OrderReviewSection'
import { PixWaitingPanel } from '@/components/order/PixWaitingPanel'
import { Button, ErrorAlert, Modal, OrderStatusBadge, Skeleton } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { formatDateTime, formatEstimatedDelivery, getOrderServiceName } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { Order, OrderStatus } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import {
    CalendarDays,
    CheckCircle2,
    Clock,
    Gamepad2,
    Hash,
    History, Lock,
    QrCode,
    Shuffle,
    UserCheck,
    Users,
    Wallet,
    XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

function AssignedBoosterValue({ order }: { order: Order }) {
  // Antes de aceito, mostra o booster preferido/exclusivo (se houver) em vez
  // de "Não associado" -- o cliente já sabe pra quem o pedido foi vinculado
  // desde a revisão, não faz sentido essa info sumir aqui até a aceitação.
  const boosterId = order.assigned_booster_id ?? order.preferred_booster_id
  const { data: booster, isLoading } = useAssignedBooster(boosterId)
  if (isLoading) return <Skeleton className="h-5 w-20 mx-auto" />
  if (!booster) return <span>Não associado</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={`/boosters/${encodeURIComponent(booster.display_name)}`} className="text-brand hover:underline">
        {booster.display_name}
      </Link>
      {!order.assigned_booster_id && (
        <span className="text-[10px] font-bold text-accent uppercase">Exclusivo</span>
      )}
    </span>
  )
}

function pixErrorMessage(err: unknown) {
  if (!(err instanceof EdgeFunctionError)) return err instanceof Error ? err.message : 'Erro ao carregar PIX'
  if (err.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (err.status === 403) return 'Você não tem permissão para esse pedido.'
  if (err.status === 409) return err.message
  return err.message
}

function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null)
      return
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  const safeRemaining = remaining ?? 0
  const mm = String(Math.floor(safeRemaining / 60)).padStart(2, '0')
  const ss = String(safeRemaining % 60).padStart(2, '0')
  return { remaining, label: `${mm}:${ss}` }
}

function PendingPaymentSection({ order }: { order: Order }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pix, setPix] = useState<{ qr_code?: string; qr_code_base64?: string | null; total_price: number; expires_at: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // O pagamento pendente aparece somente como ação no cabeçalho. O modal e
  // o QR nunca abrem automaticamente ao visitar ou trocar de pedido.
  const [open, setOpen] = useState(false)
  const lastOrderIdRef = useRef(order.id)
  useEffect(() => {
    if (lastOrderIdRef.current === order.id) return
    lastOrderIdRef.current = order.id
    setOpen(false)
    setPix(null)
    setError(null)
  }, [order.id])
  const { remaining, label } = useCountdown(pix?.expires_at ?? null)

  const generatePix = useGeneratePix(order.id)
  const cancelOrderMutation = useCancelPendingOrder()

  useEffect(() => {
    if (!pix || order.status !== 'awaiting_payment') return
    const interval = window.setInterval(async () => {
      const state = await getCustomerOrderState(order.id).catch(() => null)
      if (state?.payment_confirmed) {
        window.clearInterval(interval)
        queryClient.setQueryData(['orders', 'state', order.id], state)
        if (state.requires_credentials) {
          navigate(`/orders/${order.id}#credentials`, { replace: true })
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['orders', 'detail', order.id] }),
          queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] }),
        ])
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [pix, order.id, order.status, queryClient, navigate])

  function loadPix() {
    setError(null)
    generatePix.mutate(undefined, {
      onSuccess: (response) => {
        if (!response.qr_code) { setError('A função não retornou o código PIX.'); return }
        setPix(response)
      },
      onError: (err) => setError(pixErrorMessage(err)),
    })
  }

  function cancelOrder() {
    setError(null)
    cancelOrderMutation.mutate(order.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
        queryClient.removeQueries({ queryKey: ['orders', 'detail', order.id] })
        queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
        navigate('/orders/new?new=1', { replace: true })
      },
      onError: async () => {
        const state = await getCustomerOrderState(order.id).catch(() => null)
        if (state?.payment_confirmed) {
          queryClient.setQueryData(['orders', 'state', order.id], state)
          await queryClient.invalidateQueries({ queryKey: ['orders', 'detail', order.id] })
          navigate(`/orders/${order.id}${state.requires_credentials ? '#credentials' : ''}`, { replace: true })
          return
        }
        queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
        queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
        navigate('/orders/new?new=1', { replace: true })
      },
    })
  }

  useEffect(() => {
    if (!pix || remaining !== 0) return
    cancelOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, pix])

  async function copyPix() {
    if (!pix?.qr_code) return
    try {
      await navigator.clipboard.writeText(pix.qr_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopyError('Não foi possível copiar. Copie o código manualmente.')
      window.setTimeout(() => setCopyError(null), 4000)
    }
  }

  if (order.status !== 'awaiting_payment') return null

  const expired = remaining === 0

  return (
    <>
      {/* Mesma pill compacta ao lado do código do pedido que OrderReviewSection
          já usa pra "Avaliar booster" -- não mais um banner de linha inteira
          separado do header. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors"
      >
        <QrCode className="h-3 w-3" />
        Pagamento pendente
      </button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Pagamento PIX"
        description="Pedido ainda não pago. Gere o PIX quando quiser continuar ou cancele o pedido."
        maxWidth="xl"
      >
        {!pix ? (
        <div className="flex items-center justify-between">
          <Button size="lg" variant="danger-ghost" loading={cancelOrderMutation.isPending} onClick={cancelOrder} leftIcon={<XCircle className="h-4 w-4" />} className="w-40 shrink-0">
            Cancelar
          </Button>
          <Button size="lg" loading={generatePix.isPending} onClick={loadPix} leftIcon={<QrCode className="h-4 w-4" />} className="w-full md:w-auto min-w-[200px]">
            Gerar PIX
          </Button>
        </div>
      ) : expired ? (
        <div className="space-y-3 max-w-md">
          <ErrorAlert message="PIX expirado. Cancelando o pedido..." />
          <Button className="w-full" variant="danger" loading={cancelOrderMutation.isPending} onClick={cancelOrder} leftIcon={<XCircle className="h-4 w-4" />}>
            Cancelar pedido
          </Button>
        </div>
      ) : (
        <PixWaitingPanel
          totalPrice={Number(pix.total_price)}
          qrCode={pix.qr_code ?? ''}
          qrCodeBase64={pix.qr_code_base64 ?? null}
          remaining={remaining}
          countdownLabel={label}
          copied={copied}
          copyError={copyError}
          onCopy={copyPix}
          onCancel={cancelOrder}
          cancelling={cancelOrderMutation.isPending}
        />
      )}

      {error && <div className="mt-3"><ErrorAlert message={error} /></div>}
      </Modal>
    </>
  )
}

const CUSTOMER_DROPPABLE_STATUSES: OrderStatus[] = ['assigned', 'in_progress', 'paused', 'awaiting_customer']

function DropLockedBadge({ order }: { order: Order }) {
  if (order.status !== 'drop_requested') return null
  return (
    <span
      title="Admin analisando a troca de booster."
      className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30"
    >
      <Lock className="h-3 w-3" />
      Travado · em análise
    </span>
  )
}

function CustomerDropModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [dropReason, setDropReason] = useState('')
  const requestDrop = useRequestCustomerOrderDrop(order.id)
  const remainingDrops = Math.max(0, 2 - order.drop_count)

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) { onClose(); setDropReason('') } }}
      title="Solicitar troca de booster"
      description="Enviamos ao admin para aprovação. O pedido continua ativo e passa para outro booster, sem cobrança ou reembolso."
    >
      <p className="text-xs font-medium text-ink-secondary bg-bg-elevated rounded-lg px-3 py-2">
        Você ainda possui {remainingDrops} drop{remainingDrops === 1 ? '' : 's'} disponíve{remainingDrops === 1 ? 'l' : 'is'} para este pedido.
      </p>
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
          Motivo <span className="text-danger">*</span>
        </label>
        <textarea value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Descreva o motivo..." className="input-base w-full min-h-[100px] resize-none text-sm" maxLength={500} />
      </div>
      {requestDrop.isError && (
        <ErrorAlert message={requestDrop.error instanceof Error ? requestDrop.error.message : 'Erro'} className="mt-2" />
      )}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={() => { onClose(); setDropReason('') }}>Cancelar</Button>
        <Button
          variant="danger"
          loading={requestDrop.isPending}
          disabled={dropReason.trim().length < 10}
          onClick={() => requestDrop.mutate(dropReason.trim(), { onSuccess: () => { onClose(); setDropReason('') } })}
        >
          Enviar Solicitação
        </Button>
      </div>
    </Modal>
  )
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const currency = useCurrency()
  const { profile } = useAuthStore()
  const [dropModalOpen, setDropModalOpen] = useState(false)

  const { data: order, isLoading, isError, refetch } = useOrder(id)
  const { data: history } = useOrderStatusHistory(id)
  const { data: customerState } = useCustomerOrderState(id)
  const syncMatches = useSyncOrderMatches(id ?? '')
  const chat = useOrderChat(id)
  const confirmCompletion = useConfirmOrderCompletion(id ?? '')
  const { data: coachPackage } = useBoosterServiceDetails(order?.booster_service_id ?? undefined)

  // Chat agora fica sempre visível na página (ver grid de 2 colunas abaixo) --
  // "estar na página" já é "ter o chat aberto", então marca como lida
  // qualquer mensagem nova assim que aparece, sem depender de um popup aberto.
  const unreadChatCount = (chat.data?.messages ?? [])
    .filter((m) => m.sender_id !== profile?.id && !m.is_read).length
  const markChatRead = useMarkOrderChatRead(id ?? '')
  useEffect(() => {
    if (unreadChatCount > 0) markChatRead.mutate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadChatCount])

  // Deep link pós-pagamento (StepPayment.tsx navega pra cá com #credentials
  // quando o pedido exige credenciais) -- a seção "Conta do pedido" volta a
  // ser sempre visível (não mais um popover), então só precisa rolar até
  // ela, sem sinal de "abrir" nenhum.
  const accountSectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (window.location.hash === '#credentials' && order && customerState?.requires_credentials) {
      accountSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [order, customerState?.requires_credentials])

  useEffect(() => {
    if (order?.status === 'canceled') navigate('/orders/new?new=1', { replace: true })
  }, [order?.status, navigate])

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorAlert message="Não foi possível carregar o pedido. Tente novamente." />
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <ErrorAlert message="Pedido não encontrado." />
        <Button onClick={() => navigate('/orders')}>Voltar para meus pedidos</Button>
      </div>
    )
  }

  const { isBoostFlow, isClash, modeLabel, clashClosingLabel } = getOrderDetailInfo(order)

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
    ...((isBoostFlow || isClash) ? [{ icon: Hash, label: 'Riot ID', value: order.riot_id ?? 'Não informado' }] : []),
    { icon: UserCheck, label: 'Booster associado', value: <AssignedBoosterValue order={order} /> },
    { icon: Clock, label: 'Entrega estimada', value: isClash ? clashClosingLabel : (order.estimated_hours ? formatEstimatedDelivery(order.estimated_hours) : 'Não disponível') },
    { icon: Wallet, label: t('customer.order.totalPaid'), value: currency(order.total_price) },
  ]

  const dropVisible = CUSTOMER_DROPPABLE_STATUSES.includes(order.status)
  const dropLimitReached = order.drop_count >= 2
  const canConfirm = !!customerState?.can_confirm_completion

  return (
    <div className="space-y-6">
      <OrderPageHeader
        backHref="/orders"
        orderIdShort={order.id.slice(0, 8).toUpperCase()}
        statusBadge={<OrderStatusBadge order={order} />}
        statusActions={(
          // "Concluído" já é o texto do próprio statusBadge -- só o que
          // adiciona algo novo (ação de avaliar, alerta de atraso, link pra
          // análise de drop) fica aqui, nunca repetindo o rótulo do status.
          <>
            <PendingPaymentSection order={order} />
            <OrderReviewSection order={order} />
            <DropLockedBadge order={order} />
          </>
        )}
        extra={(
          <>
            <span className="text-xs text-ink-muted">
              {getOrderServiceName(order)} · {t('customer.order.created', { date: formatDateTime(order.created_at) })}
            </span>
            {order.drop_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30">
                <History className="h-3 w-3" />
                Pedido reatribuído · valor e prazo atualizados
              </span>
            )}
            {['in_progress', 'paused', 'awaiting_customer'].includes(order.status) && (
              <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
            )}
          </>
        )}
        onDrop={dropVisible ? () => setDropModalOpen(true) : undefined}
        dropDisabled={dropLimitReached}
        dropTooltip="Limite de drops atingido."
        primary={canConfirm ? (
          <>
            <Button variant="success" size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={confirmCompletion.isPending} onClick={() => confirmCompletion.mutate()}>
              Confirmar conclusão
            </Button>
          </>
        ) : undefined}
      />

      {confirmCompletion.isError && <ErrorAlert message={confirmCompletion.error instanceof Error ? confirmCompletion.error.message : 'Erro ao confirmar'} />}

      <OrderDetailShell
        order={order}
        viewerRole="customer"
        detailsTitle={t('customer.order.details')}
        history={history}
        coachPackage={coachPackage}
        infoItems={infoItems}
        notesLabel={t('customer.order.notes')}
        syncMatches={syncMatches}
        accountSectionRef={accountSectionRef}
        showProgress={['awaiting_payment', 'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer', 'completed', 'disputed'].includes(order.status)}
        accountLockedMessage={
          order.status === 'awaiting_payment'
            ? 'A conta do pedido fica disponível após a confirmação do pagamento.'
            : order.status === 'completed' && order.boost_mode !== 'duo'
              ? 'As credenciais ficam indisponíveis após a conclusão do pedido.'
              : order.boost_mode === 'duo' && ['paid', 'awaiting_assignment'].includes(order.status)
                ? 'A conta Duo fica disponível quando um booster aceitar o pedido.'
                : customerState && !customerState.requires_credentials && order.boost_mode !== 'duo'
                  ? 'Este serviço não exige acesso à conta.'
                  : undefined
        }
        accountContent={
          order.boost_mode === 'duo'
            ? (['in_progress', 'paused', 'awaiting_customer', 'completed'].includes(order.status)
              ? <DuoAccountHistoryList orderId={order.id} />
              : <DuoPartnerRiotId orderId={order.id} />)
            : <CredentialsSection order={order} state={customerState} />
        }
      />

      <CustomerDropModal order={order} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
