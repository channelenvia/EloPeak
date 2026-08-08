import { useOwnBoosterTop3Status } from '@/api/boosters'
import { useMarkOrderChatRead, useOrderChat } from '@/api/chat'
import { useBoosterServiceDetails } from '@/api/coaching'
import type { BoosterVisibleDuoAccount } from '@/api/duoAccounts'
import {
    lookupDuoAccountRiotRank,
    useBoosterDuoAccounts,
    useClearDuoOwnRiotId,
    useGetDuoAccountAccessToken, useReleaseDuoAccountReservation,
    useReserveDuoAccount,
    useSetDuoOwnRiotId,
} from '@/api/duoAccounts'
import {
    useBoosterOrder,
    useOrderStatusHistory,
    usePendingDropRequest,
    useRequestOrderDrop,
    useRevealOrderCredentials,
    useSyncOrderMatches,
    useUpdateOrderStatus,
    useVerifyOrderRank,
} from '@/api/orders'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { OrderChat } from '@/components/order/OrderChat'
import { OrderCoachingTopics } from '@/components/order/OrderCoachingTopics'
import { OrderDetailWidget } from '@/components/order/OrderDetailWidget'
import { OrderInfoGrid, type OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderMatchHistory } from '@/components/order/OrderMatchHistory'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { OrderProgress } from '@/components/order/OrderProgress'
import { OrderRankSummary } from '@/components/order/OrderRankSummary'
import { OrderTimeline } from '@/components/order/OrderTimeline'
import { Button, Card, ErrorAlert, Modal, OrderStatusBadge, PageLoader, RankBadge } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, CLASH_TIER_LABEL, CLASH_TIER_RANGE_LABEL } from '@/lib/clashDomain'
import { AUTO_SYNC_INTERVAL_MS, shouldAutoSync } from '@/lib/matchSync'
import { canMarkOrderComplete } from '@/lib/orderCompletionGate'
import { rankStep } from '@/lib/pricing'
import { boosterEarningsShare, formatRank, getOrderModeType, getServiceLabel, orderRequiresAccountAccess, RANK_TIER_LABEL, sortOrderExtras } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { Division, Order, RankTier } from '@/types'
import { useMutation } from '@tanstack/react-query'
import {
    Check,
    CheckCircle2,
    Clock,
    Copy,
    Gamepad2,
    Hash,
    History,
    KeyRound,
    Landmark,
    Lock,
    Play,
    RefreshCcw,
    Shuffle, Trophy,
    Users,
    Wallet,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

// Janela de proximidade de elo pra filtrar contas Duo disponíveis
// automaticamente: até Esmeralda I, aceita ±1 divisão inteira (4 degraus de
// rankStep); a partir de Diamante, a janela fecha pra ±2 subdivisões só --
// matchmaking fica mais sensível a diferença de elo nesse patamar.
const DUO_RANK_WINDOW_EMERALD_I_STEP = rankStep('emerald', 'I')

function withinDuoRankWindow(clientStep: number, accountStep: number): boolean {
  const windowSize = clientStep <= DUO_RANK_WINDOW_EMERALD_I_STEP ? 4 : 2
  return Math.abs(accountStep - clientStep) <= windowSize
}

function DuoAccountSection({ order, onLinked }: { order: Order; onLinked?: () => void }) {
  const { profile } = useAuthStore()
  const [accountSource, setAccountSource] = useState<'platform' | 'own'>(order.duo_own_riot_id ? 'own' : 'platform')
  const [ownRiotId, setOwnRiotId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [switching, setSwitching] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [search, setSearch] = useState('')

  const { data: accounts, isLoading } = useBoosterDuoAccounts()
  const reserve = useReserveDuoAccount()
  const getToken = useGetDuoAccountAccessToken()
  const release = useReleaseDuoAccountReservation()
  const setOwnAccount = useSetDuoOwnRiotId()
  const clearOwnAccount = useClearDuoOwnRiotId()

  const reserved = (accounts as BoosterVisibleDuoAccount[] | undefined)?.find(a => a.reserved_by === profile?.id && a.reserved_order_id === order.id)

  const clientStep = order.current_rank ? rankStep(order.current_rank.tier, order.current_rank.division) : null

  const available = ((accounts as BoosterVisibleDuoAccount[] | undefined)?.filter(a => a.reserved_by === null) ?? []).filter((a) => {
    if (search.trim() && !(a.riot_id ?? a.label).toLowerCase().includes(search.trim().toLowerCase())) return false
    if (clientStep != null) {
      if (!a.current_rank) return false
      if (!withinDuoRankWindow(clientStep, rankStep(a.current_rank.tier, a.current_rank.division))) return false
    }
    return true
  })

  // set_duo_own_riot_id (RPC) só valida o FORMATO "Nome#TAG" -- nunca
  // confere se a conta existe de verdade na Riot. Sem essa checagem aqui, um
  // Riot ID digitado errado só falharia silenciosamente no próximo sync
  // (best-effort: booster_duo_matches nunca reflete a estatística do
  // booster, sem nenhum aviso). Mesma consulta usada pelo admin ao cadastrar
  // conta do pool (DuoAccounts.tsx) -- só confere existência, não precisa
  // do rank aqui (não filtra/lista a conta própria em lugar nenhum).
  const saveOwnAccount = useMutation({
    mutationFn: async () => {
      const trimmed = ownRiotId.trim()
      const lookup = await lookupDuoAccountRiotRank(trimmed)
      if (!lookup.found) throw new Error('Conta Riot não encontrada. Confira o Riot ID digitado.')
      await setOwnAccount.mutateAsync({ orderId: order.id, riotId: trimmed })
    },
    onSuccess: () => { setOwnRiotId(''); onLinked?.() },
  })

  function doClearOwnAccount() {
    clearOwnAccount.mutate(order.id)
  }

  function doReserve() {
    reserve.mutate({ orderId: order.id, accountId: selectedAccountId }, {
      onSuccess: () => { setSwitching(false); setAccessToken(null); onLinked?.() },
    })
  }

  function doRelease() {
    release.mutate(order.id, { onSuccess: () => { setSwitching(false); setAccessToken(null) } })
  }

  function doGetToken() {
    if (!reserved) return
    getToken.mutate(reserved.id, {
      onSuccess: (result) => setAccessToken(result.access_token ?? null),
    })
  }

  async function copyToken() {
    if (!accessToken) return
    await navigator.clipboard.writeText(accessToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1500)
  }

  const reserveErrorMessage = (msg: string) =>
    msg === 'account_unavailable' ? 'Essa conta acabou de ser reservada por outro booster. Escolha outra.' : msg

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-brand" />
        Conta Duo
      </h3>

      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-bg-elevated p-1 max-w-md">
        <button
          type="button"
          onClick={() => setAccountSource('platform')}
          className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${accountSource === 'platform' ? 'bg-bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
        >
          Conta da plataforma
        </button>
        <button
          type="button"
          onClick={() => setAccountSource('own')}
          className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${accountSource === 'own' ? 'bg-bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
        >
          Conta própria
        </button>
      </div>

      {accountSource === 'own' ? (
        <div className="space-y-2 max-w-md">
          <p className="text-xs text-ink-secondary">
            Use sua própria conta pra jogar com o cliente — só o Riot ID, sem token (você já tem acesso).
          </p>
          {order.duo_own_riot_id ? (
            <div className="flex items-center justify-between bg-bg-elevated rounded-xl px-3 py-2.5">
              <p className="text-sm font-semibold text-ink truncate">{order.duo_own_riot_id}</p>
              <Button size="sm" variant="danger-ghost" loading={clearOwnAccount.isPending} onClick={doClearOwnAccount}>
                Remover
              </Button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={ownRiotId}
                onChange={(e) => setOwnRiotId(e.target.value)}
                placeholder="Nome#TAG"
                className="input-base flex-1 text-sm"
              />
              <Button size="sm" disabled={!ownRiotId.trim()} loading={saveOwnAccount.isPending} onClick={() => saveOwnAccount.mutate()}>
                Salvar
              </Button>
            </div>
          )}
          {(saveOwnAccount.isError || clearOwnAccount.isError) && (
            <ErrorAlert
              message={
                (saveOwnAccount.error instanceof Error && saveOwnAccount.error.message) ||
                (clearOwnAccount.error instanceof Error && clearOwnAccount.error.message) ||
                'Erro ao salvar conta'
              }
            />
          )}
        </div>
      ) : isLoading ? (
        <p className="text-xs text-ink-muted">Carregando contas...</p>
      ) : reserved && !switching ? (
        <div className="space-y-3 max-w-md">
          <div className="flex items-center justify-between bg-bg-elevated rounded-xl px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold text-ink">{reserved.riot_id ?? reserved.label}</p>
              {reserved.current_rank && (
                <p className="text-xs text-ink-muted">
                  {RANK_TIER_LABEL[reserved.current_rank.tier]} {reserved.current_rank.division}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" leftIcon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={() => setSwitching(true)}>
                Trocar
              </Button>
              <Button size="sm" variant="danger-ghost" loading={release.isPending} onClick={doRelease}>
                Liberar
              </Button>
            </div>
          </div>

          {accessToken ? (
            <div className="space-y-2">
              <textarea readOnly value={accessToken} className="input-base w-full min-h-[80px] text-[11px] font-mono resize-none" spellCheck={false} />
              <Button size="sm" className="w-full" variant={tokenCopied ? 'success' : 'secondary'} leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyToken()}>
                {tokenCopied ? 'Copiado' : 'Copiar token'}
              </Button>
              <p className="text-[10px] text-ink-muted">Use este token apenas no aplicativo autorizado — login e senha não são exibidos.</p>
            </div>
          ) : (
            <Button size="sm" className="w-full" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={getToken.isPending} onClick={doGetToken}>
              Obter token de acesso
            </Button>
          )}
          {getToken.isError && (
            <ErrorAlert message={getToken.error instanceof Error ? getToken.error.message : 'Erro ao obter token'} />
          )}
        </div>
      ) : (
        <div className="space-y-2 max-w-md">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nick..." className="input-base w-full text-xs" />
          <p className="text-[10px] text-ink-muted">
            {clientStep != null
              ? `Contas filtradas automaticamente pelo elo do cliente (${clientStep <= DUO_RANK_WINDOW_EMERALD_I_STEP ? '±1 divisão' : '±2 subdivisões'}).`
              : 'Sem elo atual do cliente pra filtrar — mostrando todas as contas disponíveis.'}
          </p>

          {available.length === 0 ? (
            <p className="text-xs text-ink-muted py-2">Nenhuma conta Duo disponível nessa faixa de elo.</p>
          ) : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
              {available.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAccountId(a.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    selectedAccountId === a.id ? 'border-brand bg-brand/10' : 'border-border-subtle hover:bg-bg-elevated/60'
                  }`}
                >
                  {a.current_rank && <RankBadge tier={a.current_rank.tier} division={a.current_rank.division} size="xs" showLabel={false} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{a.riot_id ?? a.label}</p>
                    {a.current_rank && <p className="text-[10px] text-ink-muted">{RANK_TIER_LABEL[a.current_rank.tier]} {a.current_rank.division}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          <Button size="sm" className="w-full" disabled={!selectedAccountId} loading={reserve.isPending} onClick={doReserve}>
            Reservar esta conta
          </Button>
          {switching && (
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setSwitching(false)}>Cancelar</Button>
          )}
          {reserve.isError && (
            <ErrorAlert message={reserve.error instanceof Error ? reserveErrorMessage(reserve.error.message) : 'Erro ao reservar conta'} />
          )}
        </div>
      )}
    </div>
  )
}

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

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const [dropModalOpen, setDropModalOpen] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [tokenSecondsLeft, setTokenSecondsLeft] = useState(0)
  const [tokenCopied, setTokenCopied] = useState(false)
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
  const revealAccessToken = useRevealOrderCredentials()

  function doRevealToken() {
    revealAccessToken.mutate(id!, {
      onSuccess: (result) => {
        setAccessToken(result.access_token ?? null)
        setTokenExpiresAt(result.expires_at ?? null)
      },
    })
  }

  useEffect(() => {
    if (!tokenExpiresAt) { setTokenSecondsLeft(0); return }
    function tick() {
      const secondsLeft = Math.max(0, Math.round((new Date(tokenExpiresAt!).getTime() - Date.now()) / 1000))
      setTokenSecondsLeft(secondsLeft)
      if (secondsLeft <= 0) { setAccessToken(null); setTokenExpiresAt(null) }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [tokenExpiresAt])

  async function copyAccessToken() {
    if (!accessToken) return
    await navigator.clipboard.writeText(accessToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1500)
  }

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
  const nicknameVisible = !!order.riot_id && (order.service_type === 'elo_boost' || order.service_type === 'win_boost' || order.service_type === 'md5')

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
    { icon: Gamepad2, label: 'Serviço', value: getServiceLabel(order.service_type) },
    { icon: Shuffle, label: 'Modo do pedido', value: getOrderModeType(order) },
    ...(order.service_type === 'elo_boost' || order.service_type === 'win_boost' || order.service_type === 'md5'
      ? [{ icon: Users, label: t('booster.job.queue'), value: order.queue_type === 'solo_duo' ? t('booster.job.soloQueue') : t('booster.job.flexQueue') }]
      : []),
    ...(nicknameVisible
      ? [{
        icon: Hash, label: 'Riot ID do cliente', value: (
          <span className="inline-flex items-center justify-center gap-1.5">
            {order.riot_id}
            <button type="button" onClick={() => void copyNickname()} aria-label="Copiar Riot ID" className="text-ink-muted hover:text-brand transition-colors">
              {nickCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </span>
        ),
      }]
      : []),
    { icon: Clock, label: 'Entrega estimada', value: order.estimated_hours ? formatEstimatedDeliveryLabel(order.estimated_hours) : 'Não disponível' },
    ...((order.service_type === 'win_boost' || order.service_type === 'md5') && order.wins_purchased != null
      ? [{ icon: Trophy, label: 'Vitórias Contratadas', value: `${order.wins_purchased}` }]
      : []),
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
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-ink">{t('booster.job.details')}</h3>
            <OrderDetailWidget icon={History} label="Histórico do Pedido" compact>
              <OrderTimeline history={history} bare />
            </OrderDetailWidget>
          </div>

          <div className="flex flex-wrap gap-2.5 mb-5">
            {(showDuoAccountWidget || showAccessTokenWidget) && (
              <OrderDetailWidget icon={KeyRound} label="Conta do pedido">
                {showDuoAccountWidget && <DuoAccountSection order={order} onLinked={() => syncMatches.mutate()} />}
                {showAccessTokenWidget && (
                  <div className={showDuoAccountWidget ? 'mt-4 pt-4 border-t border-border-subtle' : ''}>
                    <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-brand" />
                      Token de acesso
                    </h3>
                    <p className="text-xs text-ink-secondary mb-3">
                      Cada token é de uso único e vale só 5 minutos. Use-o apenas no aplicativo autorizado para inicializar o client — login e senha não são exibidos.
                    </p>

                    {!order.credentials_set ? (
                      <div className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
                        O cliente ainda não cadastrou as credenciais de acesso.
                      </div>
                    ) : accessToken ? (
                      <div className="space-y-2">
                        <textarea readOnly value={accessToken} className="input-base w-full min-h-[96px] text-[11px] font-mono resize-none" spellCheck={false} />
                        <p className="text-[11px] text-ink-muted text-center">
                          Expira em {Math.floor(tokenSecondsLeft / 60)}:{String(tokenSecondsLeft % 60).padStart(2, '0')}
                        </p>
                        <Button size="sm" className="w-full" variant={tokenCopied ? 'success' : 'secondary'} leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyAccessToken()}>
                          {tokenCopied ? 'Copiado' : 'Copiar token'}
                        </Button>
                        <Button size="sm" className="w-full" variant="ghost" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={revealAccessToken.isPending} onClick={doRevealToken}>
                          Criar novo token
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" className="w-full" leftIcon={<KeyRound className="h-3.5 w-3.5" />} loading={revealAccessToken.isPending} onClick={doRevealToken}>
                        Criar token
                      </Button>
                    )}

                    {revealAccessToken.isError && (
                      <ErrorAlert message={revealAccessToken.error instanceof Error ? revealAccessToken.error.message : 'Erro ao buscar token'} className="mt-2" />
                    )}
                  </div>
                )}
              </OrderDetailWidget>
            )}
          </div>

          {order.service_type === 'coaching' && coachPackage && (
            <div className="mb-4 pb-4 border-b border-border-subtle space-y-2">
              <p className="text-base font-bold text-ink">{coachPackage.title}</p>
              {coachPackage.description && <p className="text-sm text-ink-secondary leading-relaxed">{coachPackage.description}</p>}
              {coachPackage.tempo && <p className="text-xs text-ink-muted">Duração: <span className="font-semibold text-ink">{coachPackage.tempo}</span></p>}
            </div>
          )}

          {order.service_type === 'clash' && order.clash_tier && (
            <div className="mb-4 pb-4 border-b border-border-subtle space-y-2">
              <p className="text-base font-bold text-ink">{order.boost_mode === 'duo' ? 'Duo Clash' : 'Solo Clash'}</p>
              <p className="text-sm text-ink-secondary leading-relaxed">
                {order.boost_mode === 'duo'
                  ? 'Cliente joga junto com você — monte o restante do time dentro do jogo.'
                  : 'Você entra na conta do cliente e monta o time dentro do jogo.'}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs text-ink-muted">
                <span>{CLASH_TIER_LABEL[order.clash_tier]}: <span className="font-semibold text-ink">{CLASH_TIER_RANGE_LABEL[order.clash_tier]}</span></span>
                {order.clash_day && <span>Dia: <span className="font-semibold text-ink">{CLASH_DAY_LABEL[order.clash_day]}</span></span>}
                {order.riot_id && (
                  <span className="inline-flex items-center gap-1.5">
                    <Hash className="h-3 w-3 shrink-0" />
                    Riot ID: <span className="font-semibold text-ink">{order.riot_id}</span>
                    <button type="button" onClick={() => void copyNickname()} aria-label="Copiar Riot ID" className="text-ink-muted hover:text-brand transition-colors">
                      {nickCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-brand pt-1">
                A montagem do time é sua responsabilidade — organize dentro do League of Legends.
                {order.boost_mode === 'duo' && ' Use o Riot ID acima para convidar o cliente para o time.'}
              </p>
            </div>
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

      {/* Histórico de partidas / coaching */}
        {order.service_type === 'coaching'
          ? ['assigned', 'in_progress', 'paused', 'awaiting_customer', 'completed'].includes(order.status) && (
            <OrderCoachingTopics orderId={order.id} />
          )
          : ['in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'completed'].includes(order.status) && (
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
          )}


      <BoosterDropModal order={order} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
