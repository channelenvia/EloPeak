import { useOwnBoosterTop3Status } from '@/api/boosters'
import { useMarkOrderChatRead, useOrderChat } from '@/api/chat'
import { useBoosterServiceDetails } from '@/api/coaching'
import {
    useBoosterOrder,
    useOrderCustomerNickname,
    useOrderStatusHistory,
    usePendingDropRequest,
    useRequestOrderDrop,
    useSyncOrderMatches,
    useUpdateOrderStatus,
    useVerifyOrderRank,
} from '@/api/orders'
import { AccessTokenSection } from '@/components/order/AccessTokenSection'
import { ClashDetailsBlock } from '@/components/order/ClashDetailsBlock'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { DuoAccountSection } from '@/components/order/DuoAccountSection'
import { OrderAccountSection } from '@/components/order/OrderAccountSection'
import { OrderChat } from '@/components/order/OrderChat'
import { OrderCoachingTopics } from '@/components/order/OrderCoachingTopics'
import { OrderDetailWidget } from '@/components/order/OrderDetailWidget'
import { OrderInfoGrid, type OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderMatchHistory } from '@/components/order/OrderMatchHistory'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { OrderProgress } from '@/components/order/OrderProgress'
import { OrderRankSummary } from '@/components/order/OrderRankSummary'
import { OrderTimeline } from '@/components/order/OrderTimeline'
import { Button, Card, ErrorAlert, Modal, OrderStatusBadge, PageLoader, Skeleton } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { AUTO_SYNC_INTERVAL_MS, shouldAutoSync } from '@/lib/matchSync'
import { canMarkOrderComplete } from '@/lib/orderCompletionGate'
import { boosterEarningsShare, formatRank, getOrderModeType, getOrderServiceName, orderRequiresAccountAccess, sortOrderExtras } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { Division, Order, RankTier } from '@/types'
import {
    CalendarDays,
    Check,
    CheckCircle2,
    ClipboardList,
    Clock,
    Copy,
    Gamepad2,
    Hash,
    History,
    Lock,
    Play,
    Shuffle, Trophy,
    User,
    Users,
    Wallet,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

function BoosterDropModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [dropReason, setDropReason] = useState('')
  const requestDrop = useRequestOrderDrop(order.id)
  const remainingDrops = Math.max(0, 2 - order.drop_count)

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) { onClose(); setDropReason('') } }}
      title="Solicitar Drop de Pedido"
      description="Sua solicitação será enviada ao admin para aprovação. Você recebe proporcional ao quanto já concluiu do pedido -- quanto mais avançado, maior o pagamento."
    >
      <p className="text-xs font-medium text-ink-secondary bg-bg-elevated rounded-lg px-3 py-2">
        Você ainda possui {remainingDrops} drop{remainingDrops === 1 ? '' : 's'} disponíve{remainingDrops === 1 ? 'l' : 'is'} para este pedido.
      </p>
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
          Motivo <span className="text-danger">*</span>
        </label>
        <textarea value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Descreva o motivo para abandonar o pedido..." className="input-base w-full min-h-[100px] resize-none text-sm" maxLength={500} />
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

function formatEstimatedDeliveryLabel(hours: number): string {
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days} dia${days === 1 ? '' : 's'}`
}

// Nickname do cliente, no mesmo espírito do "Booster associado" que o
// cliente já vê no pedido dele -- só que sem link (booster não tem uma
// página de perfil do cliente pra navegar até).
function CustomerNicknameValue({ orderId }: { orderId: string }) {
  const { data: nickname, isLoading } = useOrderCustomerNickname(orderId)
  if (isLoading) return <Skeleton className="h-5 w-20 mx-auto" />
  return <span>{nickname ?? '—'}</span>
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const [dropModalOpen, setDropModalOpen] = useState(false)
  const [nickCopied, setNickCopied] = useState(false)
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: isTop3 } = useOwnBoosterTop3Status(profile?.id)

  const { data: order, isLoading: loadingOrder, isError: orderError, refetch: refetchOrder } = useBoosterOrder(id)
  const { data: pendingDrop } = usePendingDropRequest(id)
  const { data: history } = useOrderStatusHistory(id)
  const chat = useOrderChat(id)
  const { data: coachPackage } = useBoosterServiceDetails(order?.booster_service_id ?? undefined)

  // Chat agora fica sempre visível na página (grid de 2 colunas abaixo) --
  // "estar na página" já é "ter o chat aberto".
  const unreadChatCount = (chat.data?.messages ?? [])
    .filter((m) => m.sender_id !== profile?.id && !m.is_read).length
  const markChatRead = useMarkOrderChatRead(id ?? '')
  useEffect(() => {
    if (unreadChatCount > 0) markChatRead.mutate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadChatCount])

  const updateStatus = useUpdateOrderStatus(id ?? '')
  const syncMatches = useSyncOrderMatches(id ?? '')

  const orderRef = useRef(order)
  orderRef.current = order

  useEffect(() => {
    if (!order) return
    function maybeSync() {
      const current = orderRef.current
      if (current && shouldAutoSync(current, Date.now())) syncMatches.mutate()
    }
    maybeSync()
    const intervalId = setInterval(maybeSync, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status])
  const verifyRank = useVerifyOrderRank(id ?? '')

  async function copyNickname() {
    if (!order?.riot_id) return
    await navigator.clipboard.writeText(order.riot_id)
    setNickCopied(true)
    setTimeout(() => setNickCopied(false), 1500)
  }

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

  const isRankGated = order.target_rank != null
  const completionGate = canMarkOrderComplete(order, new Date())
  const objectiveReached = completionGate.allowed
  const dropVisible = ['assigned', 'in_progress', 'paused', 'awaiting_customer'].includes(order.status) && !pendingDrop
  const dropLimitReached = order.drop_count >= 2
  const showDuoAccountWidget = order.boost_mode === 'duo' && order.assigned_booster_id === profile?.id
    && ['assigned', 'in_progress', 'paused'].includes(order.status)
  const showAccessTokenWidget = orderRequiresAccountAccess(order) && order.assigned_booster_id === profile?.id
    && ['assigned', 'in_progress', 'paused', 'awaiting_customer'].includes(order.status)
  const nicknameVisible = !!order.riot_id && (order.service_type === 'elo_boost' || order.service_type === 'win_boost' || order.service_type === 'md5' || order.service_type === 'clash')

  // Ação principal única, alterna Iniciar -> Finalizar (spec seção 4) --
  // "Finalizar" chama o caminho certo de validação por tipo: verificação
  // real de rank via Riot API para elo_boost (verifyRank), gate de
  // partidas/vitórias/janela pros demais tipos (updateStatus + gate local).
  let primaryAction: React.ReactNode = null
  if (order.status === 'assigned') {
    primaryAction = (
      <Button variant="primary" size="sm" leftIcon={<Play className="h-4 w-4" />} loading={updateStatus.isPending} onClick={() => updateStatus.mutate('in_progress')}>
        Iniciar pedido
      </Button>
    )
  } else if (order.status === 'in_progress') {
    if (isRankGated) {
      primaryAction = (
        <Button variant="success" size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={verifyRank.isPending} onClick={() => verifyRank.mutate()}>
          Finalizar pedido
        </Button>
      )
    } else {
      primaryAction = (
        <Button
          variant="success"
          size="sm"
          leftIcon={<CheckCircle2 className="h-4 w-4" />}
          loading={updateStatus.isPending}
          disabled={!objectiveReached}
          title={!objectiveReached ? (completionGate.reason === 'clash_completion_window_closed' ? 'Disponível a partir das 23h.' : 'Sincronize ao menos 1 partida deste pedido para poder finalizar.') : undefined}
          onClick={() => updateStatus.mutate('awaiting_customer')}
        >
          Finalizar pedido
        </Button>
      )
    }
  }

  const infoItems: OrderInfoGridItem[] = [
    { icon: Gamepad2, label: 'Serviço', value: getOrderServiceName(order) },
    ...(order.service_type !== 'coaching'
      ? [{ icon: Shuffle, label: 'Modo do pedido', value: getOrderModeType(order) }]
      : []),
    ...(order.service_type === 'elo_boost' || order.service_type === 'win_boost' || order.service_type === 'md5'
      ? [{ icon: Users, label: t('booster.job.queue'), value: order.queue_type === 'solo_duo' ? t('booster.job.soloQueue') : t('booster.job.flexQueue') }]
      : order.service_type === 'clash' && order.clash_day
        ? [{ icon: Users, label: 'Dia', value: (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day!)
            return `${day}/${month} · ${CLASH_DAY_LABEL[order.clash_day!]}`
          })() }]
        : []),
    ...((order.service_type === 'win_boost' || order.service_type === 'md5') && order.wins_purchased != null
      ? [{ icon: Trophy, label: 'Vitórias Contratadas', value: `${order.wins_purchased}` }]
      : []),
    ...(order.service_type === 'coaching' && order.sessions_purchased != null
      ? [{ icon: CalendarDays, label: 'Sessões', value: `${order.sessions_purchased}` }]
      : []),
    { icon: User, label: 'Cliente', value: <CustomerNicknameValue orderId={order.id} /> },
    ...(nicknameVisible
      ? [{
        icon: Hash, label: 'Riot ID', value: (
          <span className="inline-flex items-center justify-center gap-1.5">
            {order.riot_id}
            <button type="button" onClick={() => void copyNickname()} aria-label="Copiar Riot ID" className="text-ink-muted hover:text-brand transition-colors">
              {nickCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </span>
        ),
      }]
      : []),
    {
      icon: Clock, label: 'Entrega estimada', value: order.service_type === 'clash'
        ? (order.clash_day ? (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day!)
            return `Até 23h de ${day}/${month} (${CLASH_DAY_LABEL[order.clash_day!]})`
          })() : 'Não disponível')
        : (order.estimated_hours ? formatEstimatedDeliveryLabel(order.estimated_hours) : 'Não disponível'),
    },
    { icon: Wallet, label: t('booster.job.earnings'), value: currency(order.total_price * boosterEarningsShare(isTop3)) },
  ]

  return (
    <div className="space-y-6">
      <OrderPageHeader
        backHref="/booster/orders"
        orderIdShort={order.id.slice(0, 8).toUpperCase()}
        statusBadge={<OrderStatusBadge status={order.status} />}
        statusActions={(
          // "Concluído"/"Aguardando confirmação do cliente" já são o texto
          // do próprio statusBadge -- só o que soma informação nova (aviso
          // de bloqueio por drop pendente) fica aqui.
          <>
            {(order.status === 'drop_requested' || pendingDrop) && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30">
                <Lock className="h-3 w-3" />
                Travado · em análise
              </span>
            )}
          </>
        )}
        extra={(
          <>
            {['in_progress', 'paused', 'awaiting_customer'].includes(order.status) && (
              <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
            )}
          </>
        )}
        onDrop={dropVisible ? () => setDropModalOpen(true) : undefined}
        dropDisabled={dropLimitReached}
        dropTooltip="Limite de drops atingido."
        primary={primaryAction}
      />

      {updateStatus.isError && (
          <ErrorAlert message={(() => {
            const code = updateStatus.error instanceof Error ? updateStatus.error.message : null
            if (code === 'objective_not_reached') return 'Ainda faltam vitórias contratadas para marcar como concluído.'
            if (code === 'no_matches_played') return 'Sincronize ao menos 1 partida deste pedido antes de marcar como concluído.'
            if (code === 'clash_completion_window_closed') return 'Clash só pode ser marcado como concluído a partir das 23h.'
            if (code === 'requires_rank_verification') return 'Use "Finalizar pedido" para acionar a verificação de rank via Riot API.'
            return code ?? 'Erro ao atualizar status'
          })()} />
        )}
        {verifyRank.isError && (
          <ErrorAlert message={verifyRank.error instanceof Error ? verifyRank.error.message : 'Erro ao verificar rank'} />
        )}
        {verifyRank.data && !verifyRank.data.passed && (
          <div className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
            {verifyRank.data.reason === 'account_not_found' && 'Conta Riot não encontrada. Confira o Riot ID cadastrado no pedido.'}
            {verifyRank.data.reason === 'unranked' && 'A conta ainda não tem partidas ranqueadas solo/duo nesta temporada.'}
            {verifyRank.data.reason === 'target_not_reached' && verifyRank.data.fetched_tier && (
              <>
                Rank atual verificado: <strong>{formatRank(verifyRank.data.fetched_tier as RankTier, verifyRank.data.fetched_division as Division ?? null)}</strong> —
                alvo: <strong>{formatRank(verifyRank.data.target_tier as RankTier, verifyRank.data.target_division as Division ?? null)}</strong>. Ainda não bateu.
              </>
            )}
          </div>
        )}

      {/* Detalhes do pedido (60%) + chat sempre visível (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card padding="lg" className="lg:col-span-3 h-[450px] overflow-y-auto">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold text-ink">{t('booster.job.details')}</h3>
            </div>
            <OrderDetailWidget icon={History} label="Histórico do Pedido" compact>
              <OrderTimeline history={history} bare />
            </OrderDetailWidget>
          </div>


          {order.service_type === 'coaching' && coachPackage && (
            <div className="mb-4 pb-4 border-b border-border-subtle space-y-2">
              <p className="text-base font-bold text-ink">{coachPackage.title}</p>
              {coachPackage.description && <p className="text-sm text-ink-secondary leading-relaxed">{coachPackage.description}</p>}
              {coachPackage.tempo && <p className="text-xs text-ink-muted">Duração: <span className="font-semibold text-ink">{coachPackage.tempo}</span></p>}
            </div>
          )}

          {order.service_type === 'clash' && order.clash_tier && (
            <ClashDetailsBlock
              viewerRole="booster"
              boostMode={order.boost_mode}
              clashTier={order.clash_tier}
              clashDay={order.clash_day}
              createdAt={order.created_at}
            />
          )}

          <OrderRankSummary order={order} />
          <OrderProgress order={order} hideRankBadges />

          <div className="mt-5">
            <OrderInfoGrid items={infoItems} />
          </div>

          {order.extras?.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border-subtle">
              <p className="text-xs text-ink-muted mb-1.5">Extras</p>
              <div className="flex flex-wrap gap-1.5">
                {sortOrderExtras(order.extras).map((extra) => (
                  <span key={extra.extra_id} className="text-[11px] font-medium bg-bg-elevated text-ink-secondary px-2 py-1 rounded-lg">{extra.name}</span>
                ))}
              </div>
            </div>
          )}
          {order.customer_notes && (
            <div className="mt-5 bg-bg-elevated rounded-xl p-3">
              <p className="text-xs text-ink-muted mb-1">{t('booster.job.customerNotes')}</p>
              <p className="text-sm text-ink-secondary">{order.customer_notes}</p>
            </div>
          )}
        </Card>

        <div className="lg:col-span-2 h-[450px]">
          <OrderChat orderId={order.id} viewerRole="booster" orderStatus={order.status} />
        </div>
      </div>

      {/* Histórico de partidas / coaching (60%) + conta do pedido (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 h-[350px]">
          {order.service_type === 'coaching' ? (
            ['assigned', 'in_progress', 'paused', 'awaiting_customer', 'completed'].includes(order.status) ? (
              <OrderCoachingTopics orderId={order.id} />
            ) : (
              <Card padding="md" className="h-full flex items-center justify-center">
                <p className="text-xs text-ink-muted text-center">Disponível quando o pedido for aceito.</p>
              </Card>
            )
          ) : ['in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'completed'].includes(order.status) ? (
            <OrderMatchHistory
              orderId={order.id}
              sync={order.status === 'in_progress' || order.status === 'paused' ? {
                onSync: () => syncMatches.mutate(),
                syncing: syncMatches.isPending,
                cooldownSeconds: syncMatches.cooldownSeconds,
                error: syncMatches.isError ? (syncMatches.error instanceof Error ? syncMatches.error.message : 'Erro ao sincronizar partidas') : null,
                resultMessage: syncMatches.data
                  ? (syncMatches.data.synced
                    ? (syncMatches.data.new_matches ? `${syncMatches.data.new_matches} nova(s) partida(s) registrada(s).` : 'Nenhuma partida nova encontrada.')
                    : 'Conta Riot não encontrada. Confira o Riot ID cadastrado no pedido.')
                  : null,
              } : undefined}
              pdlEstimate={order.service_type === 'elo_boost'
                ? { gain: order.avg_pdl_gain, loss: order.avg_pdl_loss, label: order.pdl_bracket ? 'PDL' : 'LP' }
                : null}
            />
          ) : (
            <Card padding="md" className="h-full flex items-center justify-center">
              <p className="text-xs text-ink-muted text-center">Histórico de partidas aparece assim que o pedido começar.</p>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2 h-[350px]">
          <OrderAccountSection>
            {showDuoAccountWidget ? (
              <DuoAccountSection order={order} onLinked={() => syncMatches.mutate()} />
            ) : showAccessTokenWidget ? (
              <AccessTokenSection order={order} />
            ) : (
              <p className="text-xs text-ink-muted text-center py-8">
                Disponível quando o pedido for aceito e estiver em andamento.
              </p>
            )}
          </OrderAccountSection>
        </div>
      </div>

      <BoosterDropModal order={order} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
