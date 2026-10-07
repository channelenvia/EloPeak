import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { isCardPaymentInAnalysis, isPaymentConfirmed } from '@/lib/orderPayment'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { useAuthStore } from '@/stores/authStore'
import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { Button, ErrorAlert } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { useCountdown } from '@/hooks/useCountdown'
import { pixErrorMessage } from '@/lib/pixErrorMessage'
import { useBoostAddons, EMPTY_ADDONS } from '@/hooks/useBoostAddons'
import { applyCoupon } from '@/lib/pricing'
import { getBoostFlow } from '@/lib/boostDomain'
import { isUuid } from '@/lib/utils'
import { ActionBar } from '@/components/ui/ActionBar'
import { PixWaitingPanel } from '@/components/order/PixWaitingPanel'
import { PaymentMethodPicker, type PaymentMethod } from '@/components/order/PaymentMethodPicker'
import { CardAnalysisNotice } from '@/components/order/CardAnalysisNotice'
import type { CardPaymentAcceptance } from '@/components/order/CardPaymentPanel'
import { useRealtimeInvalidate } from '@/api/core/realtime'
import { getCustomerOrderState, savePendingOrderFromIntent, useOrderPaymentInfo, generatePix as generatePixRequest } from '@/api/orders'
import type { PixPaymentResponse } from '@/api/orders'
import { CheckCircle2, Clock, Loader2, ShieldCheck, ChevronLeft } from 'lucide-react'

// O SDK do Mercado Pago só carrega se o cliente escolher cartão.
const CardPaymentPanel = lazy(() => import('@/components/order/CardPaymentPanel').then((m) => ({ default: m.CardPaymentPanel })))

// PIX states
type PixState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'waiting'; qr_code: string; qr_base64: string | null; expires_at: string; payment_id: string; order_id: string; total_price: number }
  | { phase: 'confirmed' }
  | { phase: 'expired'; order_id: string }
  | { phase: 'error'; message: string; order_id?: string }

export function StepPayment({ insideModal = false }: { insideModal?: boolean } = {}) {
  const { profile } = useAuthStore()
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
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingOrderId = searchParams.get('order')
  const currency = useCurrency()
  const [pix, setPix] = useState<PixState>({ phase: 'idle' })
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [savedOrderId, setSavedOrderId] = useState<string | null>(pendingOrderId)
  const [savedTotalPrice, setSavedTotalPrice] = useState<number | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [cardAcceptance, setCardAcceptance] = useState<CardPaymentAcceptance | null>(null)
  // Só gera o PIX automático depois da checagem do pedido já existente (?order=).
  const [restoreDone, setRestoreDone] = useState(!pendingOrderId)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const generatingRef = useRef(false)
  const qrRetryTimeoutRef = useRef<number | null>(null)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const restoredOrderRef = useRef<string | null>(null)
  const expiryHandledRef = useRef(false)

  const isClash = store.serviceType === 'clash'
  // Clash reaproveita o mesmo catálogo do Elo Boost (ver StepExtras.tsx):
  // Solo Clash usa 'solo_standard', Duo Clash usa 'duo_standard'.
  const flow = store.serviceType === 'elo_boost' && store.currentRank
    ? getBoostFlow(store.currentRank.tier, store.boostMode, store.queueType)
    : store.serviceType === 'win_boost' || store.serviceType === 'md5' || isClash
      ? (store.boostMode === 'duo' ? 'duo_standard' : 'solo_standard')
      : null
  // Mesma queryKey usada em StepExtras/StepReview — já em cache. Precisamos
  // do catálogo aqui só para traduzir os ids selecionados em códigos
  // estáveis (addon_codes) — o payload nunca envia o id interno do banco.
  const { data: addonData } = useBoostAddons(flow)
  const addonCatalog = addonData ?? EMPTY_ADDONS
  const addonCodes = addonCatalog
    .filter(e => store.selectedExtraIds.has(e.id))
    .map(e => e.code)
    .filter((code): code is string => !!code)
  const addonsReady = store.selectedExtraIds.size === 0 || addonData !== undefined

  // Estimativa exibida antes de gerar o PIX (mesma conta que StepReview já
  // mostrou ao cliente). O valor cobrado de fato é sempre o que a Edge
  // Function retorna, recomputado no servidor a partir de shared/pricing.ts.
  const estimatedSubtotal = store.basePrice + store.extrasPrice
  const estimatedCoupon = store.couponCode && store.serviceType
    ? applyCoupon(estimatedSubtotal, store.couponCode, store.serviceType)
    : null
  const estimatedTotal = estimatedSubtotal - (estimatedCoupon?.couponApplied ? estimatedCoupon.discountPrice : 0)
  const totalPrice = pix.phase === 'waiting' ? pix.total_price : savedTotalPrice ?? estimatedTotal

  // store.gameId/serviceId começam como slug cru ('lol', 'win_boost') até
  // OrderBuilder.tsx resolver os uuids reais em segundo plano -- clicar
  // antes disso mandaria o slug pro backend, que rejeita (.uuid() na Edge
  // Function). Derivado direto do store, sem round-trip extra.
  const catalogReady = isUuid(store.gameId ?? '') && isUuid(store.serviceId ?? '')
  const expiresAt = pix.phase === 'waiting' ? pix.expires_at : null
  const { remaining, label: countdownLabel } = useCountdown(expiresAt)

  // At the provider expiration timestamp, cancel/delete the unpaid checkout
  // through the authenticated backend and return the configurator to step 1.
  useEffect(() => {
    if (pix.phase === 'waiting' && remaining === 0 && !expiryHandledRef.current) {
      expiryHandledRef.current = true
      const orderId = pix.order_id
      setPix({ phase: 'expired', order_id: orderId })

      void invokeEdgeFunction('cancel-pending-order', {
        body: { order_id: orderId },
        timeoutMs: 20_000,
        requireAuth: true,
      }).catch(async () => {
        // A confirmation can race the final second of the countdown. Never
        // discard a payment that the backend already marked as approved.
        const state = await getCustomerOrderState(orderId).catch(() => null)
        if (isPaymentConfirmed(state)) {
          const requiresCredentials = state?.requires_credentials === true
          setPix({ phase: 'confirmed' })
          store.reset()
          navigate(`/orders/${orderId}${requiresCredentials ? '#credentials' : ''}`, { replace: true })
          return true
        }
        return false
      }).then((paymentConfirmed) => {
        if (paymentConfirmed === true) return
        queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
        queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
        startNewOrder()
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, pix.phase])

  function stopQrRetry() {
    if (qrRetryTimeoutRef.current !== null) {
      clearTimeout(qrRetryTimeoutRef.current)
      qrRetryTimeoutRef.current = null
    }
  }

  // Confirmação do pagamento: query com refetch a cada 4s (pausa com a aba
  // escondida, refaz ao voltar o foco) + Realtime em order_status_events, que
  // dispara a checagem na hora em vez de esperar o próximo ciclo.
  const watchedOrderId = pix.phase === 'waiting'
    ? pix.order_id
    : cardAcceptance || method === 'card' ? savedOrderId : null
  const { data: watchedState } = useQuery({
    queryKey: ['pix-payment-state', watchedOrderId],
    queryFn: () => getCustomerOrderState(watchedOrderId!),
    enabled: !!watchedOrderId,
    refetchInterval: 4000,
    refetchOnWindowFocus: 'always',
    retry: false,
  })
  useRealtimeInvalidate({
    channel: `pix-${watchedOrderId ?? 'none'}`,
    table: 'order_status_events',
    event: 'INSERT',
    filter: watchedOrderId ? `order_id=eq.${watchedOrderId}` : undefined,
    queryKeys: [['pix-payment-state', watchedOrderId]],
    enabled: !!watchedOrderId,
  })
  // Retomada de um pedido cujo cartão já foi enviado e segue em análise.
  const { data: paymentInfo } = useOrderPaymentInfo(savedOrderId ?? undefined, !!savedOrderId && !cardAcceptance)
  useEffect(() => {
    if (isCardPaymentInAnalysis(paymentInfo)) setCardAcceptance('pending')
  }, [paymentInfo])
  // Cartão aprovado já foi conciliado pelo servidor: confere na hora em vez de
  // esperar o próximo ciclo do polling.
  useEffect(() => {
    if (cardAcceptance === 'approved' && savedOrderId) {
      void queryClient.invalidateQueries({ queryKey: ['pix-payment-state', savedOrderId] })
    }
  }, [cardAcceptance, savedOrderId, queryClient])
  const confirmedHandledRef = useRef(false)
  useEffect(() => {
    if (!watchedOrderId || !isPaymentConfirmed(watchedState) || confirmedHandledRef.current) return
    confirmedHandledRef.current = true
    const requiresCredentials = watchedState?.requires_credentials === true
    setPix({ phase: 'confirmed' })
    store.reset()
    // Sem cleanup de propósito: ao confirmar, watchedOrderId vira null e este
    // efeito roda de novo -- um clearTimeout aqui cancelaria o redirecionamento.
    window.setTimeout(() => navigate(`/orders/${watchedOrderId}${requiresCredentials ? '#credentials' : ''}`, { replace: true }), 1500)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedOrderId, watchedState?.payment_confirmed, watchedState?.payment_status])

  useEffect(() => () => { stopQrRetry() }, [])

  // Cancela o pedido pendente no servidor (mesma edge function usada quando
  // o PIX expira sozinho) em vez de só abandonar o wizard localmente --
  // "Cancelar" aqui precisa realmente liberar o pedido, não só sair da tela.
  async function handleCancelOrder() {
    if (pix.phase !== 'waiting' || isCancelling) return
    const orderId = pix.order_id
    setIsCancelling(true)

    try {
      await invokeEdgeFunction('cancel-pending-order', {
        body: { order_id: orderId },
        timeoutMs: 20_000,
        requireAuth: true,
      })
    } catch {
      // Mesma checagem defensiva do fluxo de expiração: uma confirmação de
      // pagamento pode ter chegado bem na hora do cancelamento -- nunca
      // descarta um pagamento que o backend já marcou como aprovado.
      const state = await getCustomerOrderState(orderId).catch(() => null)
      if (isPaymentConfirmed(state)) {
        const requiresCredentials = state?.requires_credentials === true
        setPix({ phase: 'confirmed' })
        store.reset()
        navigate(`/orders/${orderId}${requiresCredentials ? '#credentials' : ''}`, { replace: true })
        return
      }
    } finally {
      setIsCancelling(false)
    }

    queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
    queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
    startNewOrder()
  }

  function buildIntent(): Record<string, unknown> {
    const base = {
      service_type: store.serviceType,
      service_id: store.serviceId!,
      game_id: store.gameId!,
      server: store.server,
      customer_notes: store.customerNotes || null,
      coupon_code: store.couponCode,
    }

    if (store.serviceType === 'clash') {
      // clashIntentSchema (backend) é .strict() e não define queue_type --
      // Clash não tem fila, só o tier (clash_tier abaixo). current_rank/
      // current_lp são aceitos (opcionais, só informativos pro card de
      // detalhes) -- ver ClashConfigPicker::lookupRiotRank, que os preenche
      // a partir da mesma consulta que já deriva o tier.
      return {
        ...base,
        boost_mode: store.boostMode,
        clash_tier: store.clashTier,
        clash_day: store.clashDay,
        current_rank: store.currentRank,
        current_lp: store.currentLp,
        addon_codes: addonCodes,
        riot_id: store.riotId,
        customer_lanes: store.customerLanes,
      }
    }

    const baseWithRank = {
      ...base,
      queue_type: store.queueType,
      current_rank: store.currentRank,
    }

    if (store.serviceType === 'elo_boost') {
      return flow === 'master_plus'
        ? {
            ...baseWithRank,
            target_rank: store.targetRank,
            boost_mode: store.boostMode,
            addon_codes: addonCodes,
            riot_id: store.riotId,
            customer_lanes: store.customerLanes,
          }
        : {
            ...baseWithRank,
            target_rank: store.targetRank,
            boost_mode: store.boostMode,
            addon_codes: addonCodes,
            win_package: store.winPackage,
            riot_id: store.riotId,
            customer_lanes: store.customerLanes,
          }
    }

    if (store.serviceType === 'md5') {
      return {
        ...baseWithRank,
        boost_mode: store.boostMode,
        wins_purchased: store.winsPurchased,
        addon_codes: addonCodes,
        riot_id: store.riotId,
        customer_lanes: store.customerLanes,
      }
    }

    return {
      ...baseWithRank,
      target_rank: store.targetRank,
      boost_mode: store.boostMode,
      wins_purchased: store.winsPurchased,
      sessions_purchased: store.sessionsPurchased,
      addon_codes: addonCodes,
      win_package: store.winPackage,
      booster_service_id: store.selectedCoachPackage?.id ?? null,
      riot_id: store.serviceType === 'win_boost' ? store.riotId : null,
      // Coaching/placement_matches não têm esse conceito de rota, mas o
      // schema (otherServiceIntentSchema) exige a chave presente pros três
      // (sem .default(), diferente de riot_id) -- omitir pra quem não é
      // win_boost derrubava a validação com "Body inválido" (400) em vez de
      // cair no valor certo. Manda vazio nesse caso.
      customer_lanes: store.serviceType === 'win_boost' ? store.customerLanes : [],
    }
  }

  async function persistPendingOrder(): Promise<string | null> {
    if (!profile || !catalogReady || !addonsReady) return null
    if (savedOrderId) return savedOrderId

    setIsSavingOrder(true)
    setSaveError(null)
    try {
      const saved = await savePendingOrderFromIntent({
        intent: buildIntent(),
        idempotencyKey: idempotencyKeyRef.current,
        preferredBoosterId: store.preferredBoosterId ?? undefined,
      })
      restoredOrderRef.current = saved.order_id
      setSavedOrderId(saved.order_id)
      setSavedTotalPrice(Number(saved.total_price))
      setSearchParams({ order: saved.order_id }, { replace: true })
      queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
      queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })
      return saved.order_id
    } catch (err) {
      setSaveError(pixErrorMessage(err))
      return null
    } finally {
      setIsSavingOrder(false)
    }
  }

  // O pedido só é criado quando o cliente clica em "Gerar PIX" (ver
  // generatePix, que chama persistPendingOrder como parte do próprio clique)
  // -- nunca automaticamente ao entrar nesta etapa. Antes disso existia um
  // auto-save aqui que criava o pedido assim que a tela de pagamento abria,
  // mesmo sem o cliente pedir pra pagar; cada reconfiguração sem clicar em
  // "Gerar PIX" deixava um pedido órfão "Aguardando pagamento" em Meus
  // Pedidos -- essa era a causa real da duplicação, não só um problema de
  // exibição no dashboard.

  // Chama a Edge Function que cria (ou reaproveita) o pedido e gera o PIX.
  // O preço nunca é enviado pelo cliente — a function recomputa tudo a
  // partir da intenção (rank, extras selecionados, pacote de vitórias etc).
  async function invokePix(orderId: string) {
    let pixData: PixPaymentResponse

    try {
      pixData = await generatePixRequest(orderId)
    } catch (err) {
      // (comentário do bloco isDeadOrder abaixo descreve pedido 404/"not
      // awaiting payment"; este ramo é diferente: MP já aprovou o pagamento
      // mas o webhook ainda não chegou -- corrida de tempo, não erro real.
      // Redireciona igual a payment_confirmed em vez de mostrar alerta.)
      if (err instanceof EdgeFunctionError && err.code === 'ALREADY_PAID') {
        const state = await getCustomerOrderState(orderId).catch(() => null)
        const requiresCredentials = state?.requires_credentials === true
        setPix({ phase: 'confirmed' })
        store.reset()
        navigate(`/orders/${orderId}${requiresCredentials ? '#credentials' : ''}`, { replace: true })
        return
      }

      // Já existe um cartão em análise para este pedido: não há QR a gerar,
      // só esperar o provedor (o polling abaixo segue acompanhando).
      if (err instanceof EdgeFunctionError && err.code === 'CARD_PAYMENT_PENDING') {
        setSavedOrderId(orderId)
        setCardAcceptance('pending')
        return
      }

      // Pedido morto -- não existe mais (404) ou não pode mais receber
      // pagamento (400 "not awaiting payment", ex.: PIX recusado no MP).
      // Limpa a vinculação (mantém a config no store) pro próximo "Gerar
      // PIX" criar um pedido novo, em vez de travar tentando o mesmo morto.
      const isDeadOrder = err instanceof EdgeFunctionError
        && (err.status === 404 || (err.status === 400 && /not awaiting payment/i.test(err.message)))
      if (isDeadOrder) {
        setSavedOrderId(null)
        setSavedTotalPrice(null)
        setSearchParams({}, { replace: true })
        // Sem isso, o retry criaria "outro" pedido só na aparência: o
        // idempotency_key antigo ainda aponta (server-side) pro MESMO
        // order_id morto, então persistPendingOrder() reencontraria e
        // reusaria esse pedido de novo, batendo no mesmo 400 pra sempre.
        idempotencyKeyRef.current = crypto.randomUUID()
        setPix({
          phase: 'error',
          message: 'Pagamento indisponível para este pedido. Clique em "Gerar PIX" para tentar de novo.',
        })
        return
      }
      const fallbackOrderId = err instanceof EdgeFunctionError && err.body && typeof err.body !== 'string'
        ? typeof err.body.order_id === 'string' ? err.body.order_id : undefined
        : undefined
      setPix({ phase: 'error', message: pixErrorMessage(err), order_id: fallbackOrderId })
      return
    }

    if (!pixData.qr_code) {
      setPix({ phase: 'error', message: 'A função não retornou o código PIX. Tente novamente.', order_id: pixData.order_id })
      return
    }

    const waitingState: Extract<PixState, { phase: 'waiting' }> = {
      phase: 'waiting',
      qr_code: pixData.qr_code,
      qr_base64: pixData.qr_code_base64 ?? null,
      expires_at: pixData.expires_at,
      payment_id: String(pixData.payment_id),
      order_id: orderId,
      total_price: Number(pixData.total_price),
    }
    setPix(waitingState)
    setSearchParams({ order: orderId }, { replace: true })
    queryClient.invalidateQueries({ queryKey: ['orders', 'customer'] })
    queryClient.invalidateQueries({ queryKey: ['resumable-customer-order'] })

    // If MP didn't return base64 yet, retry once after 3s to get it. Scoped
    // to this order (tracked in a ref, cancelled on unmount/next invokePix)
    // and only ever applied if the UI is still waiting on THIS SAME order --
    // a stray timer from a previous order's PIX must never patch whatever
    // order is currently being displayed.
    stopQrRetry()
    if (!pixData.qr_code_base64) {
      qrRetryTimeoutRef.current = window.setTimeout(async () => {
        const retry = await generatePixRequest(orderId).catch(() => null)
        if (retry?.qr_code_base64) {
          setPix((prev) =>
            prev.phase === 'waiting' && prev.order_id === orderId
              ? { ...prev, qr_base64: retry.qr_code_base64 ?? null }
              : prev,
          )
        }
      }, 3000)
    }

  }

  // Ao voltar com um pedido já criado, valida apenas se ele ainda pode ser
  // pago. Nunca gera nem reexibe o QR automaticamente; isso fica reservado
  // ao clique em "Gerar PIX".
  useEffect(() => {
    if (!profile || !pendingOrderId || restoredOrderRef.current === pendingOrderId) return
    restoredOrderRef.current = pendingOrderId
    setSavedOrderId(pendingOrderId)

    void (async () => {
      const state = await getCustomerOrderState(pendingOrderId).catch(() => null)
      if (isPaymentConfirmed(state)) {
        const requiresCredentials = state?.requires_credentials === true
        navigate(`/orders/${pendingOrderId}${requiresCredentials ? '#credentials' : ''}`, { replace: true })
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
        return
      }
    })().catch((err) => {
      setSaveError(pixErrorMessage(err))
    }).finally(() => {
      setRestoreDone(true)
    })
    // Só na chegada do pendingOrderId -- invokePix/navigate são estáveis o
    // suficiente pro propósito deste efeito (roda uma vez por order id, via
    // o guard restoredOrderRef acima).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOrderId, profile])

  function startNewOrder() {
    stopQrRetry()
    store.reset()
    store.setStep('service')
    setSavedOrderId(null)
    setSavedTotalPrice(null)
    setSaveError(null)
    setPix({ phase: 'idle' })
    setMethod(null)
    setCardAcceptance(null)
    idempotencyKeyRef.current = crypto.randomUUID()
    expiryHandledRef.current = false
    setSearchParams({ new: '1' }, { replace: true })
  }

  async function generatePix() {
    if (!profile || generatingRef.current) return

    if (!catalogReady) {
      setPix({ phase: 'error', message: 'Ainda carregando o catálogo — aguarde um instante e tente novamente.' })
      return
    }

    generatingRef.current = true
    try {
      const erroredOrderId = pix.phase === 'error' ? pix.order_id : undefined
      const orderId = erroredOrderId ?? savedOrderId ?? pendingOrderId ?? await persistPendingOrder()
      if (!orderId) { setMethod(null); return }
      setPix({ phase: 'generating' })
      await invokePix(orderId)
    } catch (err) {
      setPix({ phase: 'error', message: err instanceof Error ? err.message : 'Erro desconhecido' })
    } finally {
      generatingRef.current = false
    }
  }

  // Escolher a forma de pagamento é o clique explícito que cria o pedido (ver
  // persistPendingOrder). PIX segue direto para a cobrança; cartão só libera o
  // formulário depois do pedido salvo.
  async function chooseMethod(next: PaymentMethod) {
    if (!profile || generatingRef.current) return
    setPix({ phase: 'idle' })
    setMethod(next)
    if (next === 'pix') return generatePix()

    generatingRef.current = true
    try {
      const orderId = savedOrderId ?? pendingOrderId ?? await persistPendingOrder()
      if (!orderId) setMethod(null)
    } finally {
      generatingRef.current = false
    }
  }

  async function copyPix() {
    if (pix.phase !== 'waiting') return
    try {
      await navigator.clipboard.writeText(pix.qr_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopyError('Não foi possível copiar. Copie o código manualmente.')
      setTimeout(() => setCopyError(null), 4000)
    }
  }

  // ── Confirmed ────────────────────────────────────────────────────────────────
  if (pix.phase === 'confirmed') {
    return (
      <div className="text-center py-8">
        <div className="h-16 w-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h2 className="text-xl font-bold text-ink mb-2">Pagamento Confirmado!</h2>
        <p className="text-sm text-ink-secondary">Pagamento aprovado. Redirecionando para os próximos passos…</p>
      </div>
    )
  }

  // ── Expired ──────────────────────────────────────────────────────────────────
  if (pix.phase === 'expired') {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto">
          <Clock className="h-8 w-8 text-danger" />
        </div>
        <h2 className="text-xl font-bold text-ink">PIX Expirado</h2>
        <p className="text-sm text-ink-secondary">O pedido não foi pago e está sendo cancelado. Reiniciando o configurador…</p>
      </div>
    )
  }

  // ── Waiting (QR code shown) ───────────────────────────────────────────────
  if (pix.phase === 'waiting') {
    return (
      <PixWaitingPanel
        totalPrice={totalPrice}
        qrCode={pix.qr_code}
        qrCodeBase64={pix.qr_base64}
        remaining={remaining}
        countdownLabel={countdownLabel}
        copied={copied}
        copyError={copyError}
        onCopy={copyPix}
        onCancel={handleCancelOrder}
        cancelling={isCancelling}
      />
    )
  }

  const centeredStatus = (label: string) => (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-brand" />
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
    </div>
  )

  // ── Salvando o pedido (ou conferindo o já salvo) ─────────────────────────────
  if (isSavingOrder) return centeredStatus('Salvando…')
  if (!restoreDone) return centeredStatus('Verificando seu pedido…')

  // ── Cartão aceito: aprovado confirma sozinho; em análise espera o provedor ──
  if (cardAcceptance === 'approved') return centeredStatus('Pagamento aprovado! Confirmando seu pedido…')
  if (cardAcceptance === 'pending') {
    return <CardAnalysisNotice actionLabel="Ver meus pedidos" onAction={() => navigate('/orders')} />
  }

  // ── Cartão: formulário liberado depois do pedido salvo ───────────────────────
  const cardOrderId = savedOrderId ?? pendingOrderId
  if (method === 'card' && cardOrderId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setMethod(null)} leftIcon={<ChevronLeft className="h-4 w-4" />}>
          Trocar forma de pagamento
        </Button>
        <Suspense fallback={centeredStatus('Carregando formulário…')}>
          <CardPaymentPanel orderId={cardOrderId} totalPrice={totalPrice} onAccepted={setCardAcceptance} />
        </Suspense>
      </div>
    )
  }

  // ── PIX sendo gerado ─────────────────────────────────────────────────────────
  if (pix.phase === 'generating') return centeredStatus('Gerando seu PIX…')

  // ── Escolha da forma de pagamento ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Título só fora do Modal -- o Modal já tem o próprio cabeçalho (ver
          OrderBuilder.tsx). Aparece no fluxo de retomada em tela cheia. */}
      {!insideModal && <h2 className="text-lg font-bold text-ink">Pagamento</h2>}

      <div className="card-brand flex items-center justify-between rounded-2xl p-5">
        <div>
          <p className="text-xs text-ink-secondary">Total do Pedido</p>
          <p className="mt-0.5 text-2xl font-extrabold text-ink">{currency(totalPrice)}</p>
        </div>
      </div>

      <p className="text-sm font-medium text-ink-secondary">Como você prefere pagar?</p>
      <PaymentMethodPicker
        onSelect={chooseMethod}
        disabled={totalPrice <= 0 || !catalogReady || !addonsReady}
      />

      {pix.phase === 'error' && <ErrorAlert message={pix.message} />}
      {saveError && pix.phase !== 'error' && <ErrorAlert message={saveError} />}

      {totalPrice <= 0 && (
        <p className="text-center text-xs text-danger">Configure seu pedido para ver o preço.</p>
      )}

      {!insideModal && (
        <ActionBar>
          <Button variant="secondary" onClick={store.prevStep} leftIcon={<ChevronLeft className="h-4 w-4" />}>
            Voltar
          </Button>
        </ActionBar>
      )}

      <div className="flex items-start gap-3 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        Processado pelo Mercado Pago. Não armazenamos seus dados bancários.
      </div>
    </div>
  )
}
