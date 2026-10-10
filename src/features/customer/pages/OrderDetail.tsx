import { boosterProfilePath } from '@/lib/boosterPath'
import { OrderCompletionNotice } from '../components/OrderCompletionNotice'
import { CancellationInfo } from '../components/CancellationInfo'
import { useAssignedBooster } from '@/api/boosters'
import { isCardPaymentInAnalysis, isPaymentConfirmed } from '@/lib/orderPayment'
import { ActionBar } from '@/components/ui/ActionBar'
import { Badge } from '@/components/ui/Badge'
import { useMarkOrderChatRead, useOrderChat } from '@/api/chat'
import { useBoosterServiceDetails } from '@/api/coaching'
import {
    getCustomerOrderState,
    useCancelPendingOrder,
    useConfirmOrderCompletion,
    useCustomerOrderState,
    useGeneratePix,
    useOrder, useOrderPaymentInfo, useOrderStatusHistory,
    useRequestCustomerOrderDrop,
    useSyncOrderMatches,
} from '@/api/orders'
import { useCountdown } from '@/hooks/useCountdown'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { CredentialsSection } from '@/components/order/CredentialsSection'
import { DuoAccountHistoryList } from '@/components/order/DuoAccountHistoryList'
import { DuoPartnerRiotId } from '@/components/order/DuoPartnerRiotId'
import { OrderDetailShell } from '@/components/order/OrderDetailShell'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import type { OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { OrderReviewSection } from '@/components/order/OrderReviewSection'
import { CardAnalysisNotice } from '@/components/order/CardAnalysisNotice'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import { PaymentMethodPicker } from '@/components/order/PaymentMethodPicker'
import { PixWaitingPanel } from '@/components/order/PixWaitingPanel'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { Button, ErrorAlert, Modal, OrderStatusBadge, Skeleton } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { formatDateTime, formatEstimatedDelivery, getOrderServiceName, getOrderStatusGroup } from '@/lib/utils'
import { describeOrderStatus, ORDER_CHAT_ANCHOR_ID } from '@/lib/orderStatusInfo'
import { useOwnReview } from '@/api/reviews'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'
import { useAuthStore } from '@/stores/authStore'
import type { Order } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import {
    CalendarDays,
    CheckCircle2,
    ChevronLeft,
    Clock,
    Gamepad2,
    Hash,
    History,
    Loader2,
    Route,
    Shuffle,
    UserCheck,
    Users,
    Wallet,
    XCircle,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useParams } from 'react-router-dom'

// O SDK do Mercado Pago só carrega se o cliente escolher cartão.
const CardPaymentPanel = lazy(() => import('@/components/order/CardPaymentPanel').then((m) => ({ default: m.CardPaymentPanel })))

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
      <Link to={boosterProfilePath(booster)} className="text-brand hover:underline">
        {booster.display_name}
      </Link>
      {!order.assigned_booster_id && (
        <span className={`text-2xs font-bold uppercase ${order.reassigned_by_admin ? 'text-rank-master' : 'text-accent'}`}>
          {order.reassigned_by_admin ? 'Reatribuído' : 'Exclusivo'}
        </span>
      )}
    </span>
  )
}

function PendingPaymentSection({ order, open, onOpenChange: setOpen }: { order: Order; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pix, setPix] = useState<{ qr_code?: string; qr_code_base64?: string | null; total_price: number; expires_at: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<'card' | null>(null)
  const [cardAcceptance, setCardAcceptance] = useState<CardPaymentAcceptance | null>(null)
  // O modal é aberto pelo badge de status (nunca automaticamente ao visitar
  // ou trocar de pedido).
  const lastOrderIdRef = useRef(order.id)
  useEffect(() => {
    if (lastOrderIdRef.current === order.id) return
    lastOrderIdRef.current = order.id
    setOpen(false)
    setPix(null)
    setError(null)
    setMethod(null)
    setCardAcceptance(null)
  }, [order.id, setOpen])
  const { remaining, label } = useCountdown(pix?.expires_at ?? null)

  const generatePix = useGeneratePix(order.id)
  const { data: paymentInfo } = useOrderPaymentInfo(order.id, order.status === 'awaiting_payment')
  const cardInAnalysis = cardAcceptance === 'pending' || isCardPaymentInAnalysis(paymentInfo)
  const cancelOrderMutation = useCancelPendingOrder()

  // Reconfirma o estado ao vivo do pedido e redireciona se o pagamento já foi
  // confirmado nesse meio-tempo -- usada tanto no polling normal quanto nos
  // dois pontos que cancelam o pedido (erro do cancelamento E o timeout do
  // countdown), pra nenhum dos dois arriscar cancelar um pedido que acabou de
  // ser pago (webhook confirmando bem no instante do vencimento).
  const redirectIfPaymentConfirmed = useCallback(async (): Promise<boolean> => {
    const state = await getCustomerOrderState(order.id).catch((err: unknown) => {
      // Loga a causa real -- sem isso, uma falha real de rede/servidor fica
      // indistinguível de "ainda não confirmado".
      console.error('Failed to check customer order state', err instanceof Error ? err.message : err)
      return null
    })
    if (!isPaymentConfirmed(state)) return false

    queryClient.setQueryData(['orders', 'state', order.id], state)
    await queryClient.invalidateQueries({ queryKey: ['orders', 'detail', order.id] })
    navigate(`/orders/${order.id}${state?.requires_credentials ? '#credentials' : ''}`, { replace: true })
    return true
  }, [order.id, queryClient, navigate])

  // Cartão aprovado já foi conciliado pelo servidor: confere na hora.
  useEffect(() => {
    if (cardAcceptance === 'approved') void redirectIfPaymentConfirmed()
  }, [cardAcceptance, redirectIfPaymentConfirmed])

  useEffect(() => {
    if ((!pix && !cardAcceptance && method !== 'card') || order.status !== 'awaiting_payment') return
    const interval = window.setInterval(async () => {
      const confirmed = await redirectIfPaymentConfirmed()
      if (confirmed) {
        window.clearInterval(interval)
        await queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [pix, cardAcceptance, method, order.status, queryClient, redirectIfPaymentConfirmed])

  function loadPix() {
    setError(null)
    generatePix.mutate(undefined, {
      onSuccess: (response) => {
        if (!response.qr_code) { setError('A função não retornou o código PIX.'); return }
        setPix(response)
      },
      onError: (err) => {
        if (err instanceof EdgeFunctionError && err.code === 'CARD_PAYMENT_PENDING') {
          setCardAcceptance('pending')
          return
        }
        setError(pixErrorMessage(err))
      },
    })
  }

  const cancelOrder = useCallback(() => {
    setError(null)
    cancelOrderMutation.mutate(order.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
        queryClient.removeQueries({ queryKey: ['orders', 'detail', order.id] })
        queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
        navigate('/orders/new?new=1', { replace: true })
      },
      onError: async () => {
        // Reconfirma antes de tratar como "cancelamento falhou de vez" -- o
        // cancelamento pode ter sido rejeitado justamente porque o pagamento
        // acabou de ser confirmado (corrida com o webhook do MP).
        const confirmed = await redirectIfPaymentConfirmed()
        if (confirmed) return
        queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
        queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
        navigate('/orders/new?new=1', { replace: true })
      },
    })
  }, [order.id, cancelOrderMutation, queryClient, navigate, redirectIfPaymentConfirmed])

  useEffect(() => {
    if (!pix || remaining !== 0) return
    // Reconfirma o estado ao vivo ANTES de cancelar por timeout -- o poll de
    // 5s (efeito acima) pode confirmar o pagamento bem no instante do
    // vencimento; sem checar de novo aqui, o timeout cancelaria um pedido
    // que acabou de ser pago.
    void (async () => {
      const confirmed = await redirectIfPaymentConfirmed()
      if (!confirmed) cancelOrder()
    })()
  }, [remaining, pix, redirectIfPaymentConfirmed, cancelOrder])

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
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Pagamento"
        description="Pedido ainda não pago. Escolha a forma de pagamento para continuar ou cancele o pedido."
        maxWidth="md"
      >
        {cardAcceptance === 'approved' ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="text-sm font-medium text-ink-secondary">Pagamento aprovado! Confirmando seu pedido…</p>
          </div>
        ) : cardInAnalysis ? (
          <CardAnalysisNotice actionLabel="Fechar" onAction={() => setOpen(false)} />
        ) : method === 'card' ? (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setMethod(null)} leftIcon={<ChevronLeft className="h-4 w-4" />}>
              Trocar forma de pagamento
            </Button>
            <Suspense fallback={<Loader2 className="mx-auto my-10 h-8 w-8 animate-spin text-brand" />}>
              <CardPaymentPanel orderId={order.id} totalPrice={Number(order.total_price)} onAccepted={setCardAcceptance} />
            </Suspense>
          </div>
        ) : !pix ? (
        <div className="space-y-4">
          <PaymentMethodPicker
            onSelect={(next) => (next === 'card' ? setMethod('card') : loadPix())}
            disabled={generatePix.isPending}
          />
          <ActionBar>
            <Button variant="secondary" loading={cancelOrderMutation.isPending} disabled={generatePix.isPending} onClick={cancelOrder} leftIcon={<XCircle className="h-4 w-4" />}>
              Cancelar pedido
            </Button>
          </ActionBar>
          {generatePix.isPending && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-secondary" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-brand" /> Gerando seu PIX…
            </p>
          )}
        </div>
      ) : expired ? (
        <div className="space-y-3 max-w-md">
          <ErrorAlert message="PIX expirado. Cancelando o pedido…" />
          <Button variant="danger" loading={cancelOrderMutation.isPending} onClick={cancelOrder} leftIcon={<XCircle className="h-4 w-4" />}>
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

// Mesmo teto de drop_count usado pelo backend (apply_order_drop, ver
// supabase/migrations) -- centralizado aqui em vez de repetir o literal 2 em
// dois pontos deste arquivo.
const MAX_CUSTOMER_DROPS = 2


function CustomerDropModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const requestDrop = useRequestCustomerOrderDrop(order.id)
  const remainingDrops = Math.max(0, MAX_CUSTOMER_DROPS - order.drop_count)
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })

  function close() { onClose(); reset({ reason: '' }) }
  function submit(data: { reason: string }) {
    requestDrop.mutate(data.reason.trim(), { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Solicitar troca de booster"
      description="Enviamos ao admin para aprovação. O pedido continua ativo e passa para outro booster, sem cobrança ou reembolso."
    >
      <p className="text-xs font-medium text-ink-secondary bg-bg-raised rounded-lg px-3 py-2">
        Você ainda possui {remainingDrops} drop{remainingDrops === 1 ? '' : 's'} disponíve{remainingDrops === 1 ? 'l' : 'is'} para este pedido.
      </p>
      <div>
        <label htmlFor="customer-drop-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">
          Motivo <span className="text-danger">*</span>
        </label>
        <textarea id="customer-drop-reason" {...register('reason')} placeholder="Descreva o motivo…" className="input-base w-full min-h-[100px] resize-none text-sm" maxLength={500} />
      </div>
      {requestDrop.isError && (
        <ErrorAlert message={requestDrop.error instanceof Error ? requestDrop.error.message : 'Erro'} className="mt-2" />
      )}
      <ActionBar>
        <Button disabled={requestDrop.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="danger"
          loading={requestDrop.isPending}
          disabled={!isValid}
          onClick={handleSubmit(submit)}
        >
          Enviar solicitação
        </Button>
      </ActionBar>
    </Modal>
  )
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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
    // markChatRead (objeto de useMutation) muda de identidade a cada render
    // independente de unreadChatCount -- incluí-lo na dependency array
    // disparia mutate() de novo em qualquer re-render não relacionado
    // enquanto ainda houver mensagem não lida, não só quando o count muda.
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
    // Pedido cancelado e NAO pago volta ao configurador; cancelado depois de pago continua visivel (reembolso).
    if (order?.status === 'canceled' && order.payment_status !== 'paid') navigate('/orders/new?new=1', { replace: true })
  }, [order?.status, order?.payment_status, navigate])

  // O badge de status é o ponto de entrada das ações do pedido (pagar,
  // enviar credenciais, avaliar) -- os modais abrem por aqui.
  const [payOpen, setPayOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const { data: paymentInfo } = useOrderPaymentInfo(order?.id, order?.status === 'awaiting_payment')
  const { data: ownReview, isLoading: reviewLoading } = useOwnReview(order?.status === 'completed' ? order.id : undefined)

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
    ...getLaneDisplayItems(order, 'customer').map((item) => ({ icon: Route, label: item.label, value: <ServiceTagPills lanes={item.lanes} allLabel={item.allLabel} compact emptyFallback="---" /> })),
    { icon: UserCheck, label: 'Booster associado', value: <AssignedBoosterValue order={order} /> },
    { icon: Clock, label: 'Entrega estimada', value: isClash ? clashClosingLabel : (order.estimated_hours ? formatEstimatedDelivery(order.estimated_hours) : 'Não disponível') },
    { icon: Wallet, label: 'Total Pago', value: currency(order.total_price) },
  ]

  // getOrderStatusGroup === 'in_progress' cobre assigned/in_progress/paused
  // sempre, e awaiting_customer só quando já tem booster designado -- mais
  // preciso que a lista antiga (que incluía awaiting_customer mesmo antes de
  // ter booster, quando "trocar de booster" não faz sentido nenhum ainda).
  const dropVisible = getOrderStatusGroup(order) === 'in_progress'
  // 3o drop e so do admin: com o limite atingido o cliente fala com a equipe pelo chat do pedido.
  const dropLimitReached = order.drop_count >= MAX_CUSTOMER_DROPS
  const canConfirm = !!customerState?.can_confirm_completion

  const statusGroup = getOrderStatusGroup(order)
  const statusAction =
    order.status === 'awaiting_payment' ? { label: 'Clique para pagar', run: () => setPayOpen(true) }
    : statusGroup === 'awaiting_credentials' && customerState?.requires_credentials
      ? { label: 'Clique para enviar as credenciais', run: () => accountSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    : order.status === 'completed' && !reviewLoading && !ownReview ? { label: 'Clique para avaliar', run: () => setReviewOpen(true) }
    : order.status === 'awaiting_customer' && order.assigned_booster_id
      ? { label: 'Clique para abrir o chat', run: () => document.getElementById(ORDER_CHAT_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    : null

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
            {['in_progress', 'paused', 'awaiting_customer'].includes(order.status) && (
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
        // Deliberadamente NÃO usa getOrderStatusGroup: essa lista é "todo
        // status exceto canceled/refunded/under_review/draft" e inclui
        // 'disputed' de propósito (mostra a barra de progresso mesmo em
        // disputa), enquanto getOrderStatusGroup classifica 'disputed' como
        // 'hidden' junto com canceled/refunded -- usar o grupo aqui
        // esconderia o progresso de um pedido em disputa.
        showProgress={['awaiting_payment', 'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer', 'completed', 'disputed'].includes(order.status)}
        accountLockedMessage={
          order.status === 'awaiting_payment'
            ? 'A conta do pedido fica disponível após a confirmação do pagamento.'
            : order.status === 'completed' && order.boost_mode !== 'duo'
              ? 'As credenciais ficam indisponíveis após a conclusão do pedido.'
              : order.boost_mode === 'duo' && getOrderStatusGroup(order) === 'awaiting_booster'
                ? 'A conta Duo fica disponível quando um booster aceitar o pedido.'
                : customerState && !customerState.requires_credentials && order.boost_mode !== 'duo'
                  ? 'Este serviço não exige acesso à conta.'
                  : undefined
        }
        accountContent={
          order.boost_mode === 'duo'
            // Deliberadamente NÃO usa getOrderStatusGroup: esse grupo também
            // inclui 'assigned', mas o histórico de partidas duo só existe
            // depois que a sincronização de fato começou (in_progress em
            // diante) -- em 'assigned' ainda não há nada pra mostrar, então
            // continua caindo no card de "Riot ID do parceiro" até lá.
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
