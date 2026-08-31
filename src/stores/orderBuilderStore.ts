import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { getBoostFlow, isMasterPlusCurrentTier, isDuoBlockedAtTier, type BoostFlow, type BoostMode as BoostFlowMode } from '@/lib/boostDomain'
import { DEFAULT_COUPON_CODE } from '@/lib/pricing'
import type { GameSlug, ServiceType, QueueType, BoostMode, Rank, ClashTier, ClashDay } from '@/types'

export type OrderBuilderStep = 'service' | 'configure' | 'extras' | 'review' | 'payment'

interface OrderBuilderState {
  step: OrderBuilderStep
  steps: OrderBuilderStep[]

  // Selections
  gameSlug: GameSlug | null
  gameId: string | null
  serviceType: ServiceType | null
  serviceId: string | null
  currentRank: Rank | null
  targetRank: Rank | null
  queueType: QueueType
  boostMode: BoostMode
  server: string
  winsPurchased: number | null
  sessionsPurchased: number | null
  customerNotes: string
  // Ids (service_extras.id) dos addons selecionados — um Set, não um array de
  // clique: a ORDEM de exibição nunca vem daqui, sempre do catálogo (que já
  // chega ordenado por sort_order). Ver shared/boostDomain.ts::sortAddonsBySortOrder.
  selectedExtraIds: Set<string>
  winPackage: number | null   // 1, 3 or 5 extra wins; null = none

  // Clash: tier fixo (Iron–Diamond/Master+ agrupados em 4 faixas) e dia
  // agendado — nenhum dos dois existe pra outro serviceType.
  clashTier: ClashTier | null
  clashDay: ClashDay | null

  // Pedido direto: booster escolhido no perfil público (via ?booster= na URL
  // de entrada). Só exibição/roteamento — a validação real acontece no
  // servidor ao criar o pedido.
  preferredBoosterId: string | null
  preferredBoosterName: string | null

  // Riot ID (nome#tag) — usado depois pra verificar automaticamente se o
  // rank alvo foi atingido antes de concluir o pedido.
  riotId: string

  // Rotas (lanes) escolhidas no configurador -- elo_boost/win_boost/md5/
  // clash, máx. 2. Semântica muda com boostMode (ver StepConfigure.tsx):
  // solo = rota(s) pedida(s) pro booster jogar; duo = rota(s) que o cliente
  // vai jogar ele mesmo.
  customerLanes: string[]

  // Verdadeiro enquanto uma consulta à Riot (rank atual / elegibilidade MD5)
  // está em andamento — movido de useState local em StepConfigure.tsx para
  // o store pra que OrderBuilder.tsx possa bloquear o avanço de step
  // enquanto a consulta não termina (ver isStepComplete).
  riotLookupLoading: boolean

  // Verdadeiro depois que o usuário tenta avançar de step com campos
  // obrigatórios faltando/inválidos — liga os hints de erro inline em
  // StepConfigure.tsx (FormField error=...) sem exibi-los antes da primeira
  // tentativa.
  stepAttempted: boolean

  // Verdadeiro assim que uma consulta Riot bem-sucedida preenche
  // rank/LP/PDL automaticamente — usado para travar esses campos até o
  // usuário clicar em "Editar" (setRiotAutoFilled(false)) ou alterar o
  // Riot ID manualmente.
  riotAutoFilled: boolean

  // Verdadeiro após uma verificação de conta bem-sucedida na fila atual —
  // porta de entrada do resto do formulário (eloboost/vitórias só liberam
  // ranks/extras depois disso). Reseta ao mudar Riot ID, fila ou serviço,
  // forçando nova verificação (a Riot é consultada por fila).
  riotVerified: boolean

  // Verdadeiro quando a conta consultada JÁ tem rank na fila atual — o toggle
  // de MD5 fica desabilitado (anti-fraude). O backend também rejeita, isto só
  // impede a tentativa no cliente. Reseta junto com riotVerified.
  md5Blocked: boolean

  // MD5: garantia de win rate nas partidas de posicionamento — toggle dentro
  // do fluxo "Vitórias" (win_boost), não um serviço separado na tela, mas
  // muda serviceType para 'md5' internamente (ver StepConfigure.tsx).
  isMd5: boolean
  md5MatchesRemaining: number | null
  md5MatchesRemainingCeiling: number | null

  // Pacote de coach escolhido (booster_services) — preço vem sempre daqui,
  // nunca editável pelo cliente. Selecionar um pacote também vincula o
  // pedido ao booster dono dele via setPreferredBooster.
  selectedCoachPackage: {
    id: string; title: string; price: number; tempo: string | null; description: string | null; requirements: string | null
    lanes: string[] | null; specialties: string[] | null; champions: string[] | null
  } | null

  // LP (PDL) — fluxo padrão (Solo/Duo, Iron–Diamond)
  currentLp: number
  avgLpGain: number
  avgLpLoss: number

  // PDL — fluxo Master+ (rank atual Master/Grão-Mestre). Não existe PDL alvo:
  // o preço vem da tabela comercial por faixa de PDL atual + progressão.
  currentPdl: number
  avgPdlGain: number
  avgPdlLoss: number

  // Cupom de desconto — só o código digitado, aplicado depois de validado
  // client-side (shared/pricing.ts::applyCoupon, exibição/estimativa
  // apenas). O valor cobrado de fato sempre vem recomputado no servidor.
  couponCode: string | null

  // Computed
  basePrice: number
  extrasPrice: number
  estimatedHours: number | null
  // Percentual de modificador de PDL efetivamente aplicado ao basePrice
  // (-5, 0 ou +15) — null para Master+ e para qualquer serviceType que não
  // seja elo_boost padrão (Iron–Diamond). Espelha OrderPriceResult.pdlModifierPct.
  pdlModifierPct: number | null

  // Actions
  setStep: (step: OrderBuilderStep) => void
  nextStep: () => void
  prevStep: () => void
  setGame: (slug: GameSlug, id: string) => void
  setService: (type: ServiceType, id: string) => void
  // Só troca o uuid do serviço (resolução slug→uuid feita em OrderBuilder),
  // SEM resetar winsPurchased/MD5 como setService faz — senão a resolução do
  // uuid apagaria as partidas restantes detectadas pela Riot logo após ativar
  // o MD5.
  setServiceId: (id: string) => void
  setCurrentRank: (rank: Rank) => void
  // Guarda o rank real (tier+divisão+LP) detectado pela consulta à Riot do
  // Clash -- puramente informativo pro card de detalhes, não deve disparar
  // nenhuma das regras específicas de elo_boost do setCurrentRank (forçar
  // solo em Master+, resetar rank alvo/addons/winPackage etc.), que não se
  // aplicam a Clash e causariam bugs (ex.: verificar um rank Grão-Mestre
  // trocaria silenciosamente Duo Clash pra Solo).
  setClashCurrentRank: (rank: Rank, lp: number) => void
  setTargetRank: (rank: Rank | null) => void
  setQueueType: (queue: QueueType) => void
  setBoostMode: (mode: BoostMode) => void
  setServer: (server: string) => void
  setWinsPurchased: (wins: number) => void
  setIsMd5: (isMd5: boolean) => void
  setMd5MatchesRemaining: (n: number) => void
  setMd5MatchesRemainingFromApi: (n: number) => void
  setSessionsPurchased: (sessions: number) => void
  setNotes: (notes: string) => void
  toggleExtra: (extraId: string) => void
  setWinPackage: (wins: number | null) => void
  setClashTier: (tier: ClashTier | null) => void
  setClashDay: (day: ClashDay | null) => void
  setPreferredBooster: (id: string, name: string) => void
  clearPreferredBooster: () => void
  setRiotId: (riotId: string) => void
  setCustomerLanes: (lanes: string[]) => void
  setRiotAutoFilled: (v: boolean) => void
  setRiotVerified: (v: boolean) => void
  setMd5Blocked: (v: boolean) => void
  // Limpa qualquer resultado de uma conta consultada antes (rank/LP/PDL/MD5 e
  // flags de verificação) — chamado no início de cada nova busca pra que os
  // dados da conta anterior nunca vazem pra conta nova.
  clearRiotLookup: () => void
  setRiotLookupLoading: (v: boolean) => void
  setStepAttempted: (v: boolean) => void
  setSelectedCoachPackage: (pkg: OrderBuilderState['selectedCoachPackage']) => void
  setCurrentLp: (lp: number) => void
  setAvgLpGain: (lp: number) => void
  setAvgLpLoss: (lp: number) => void
  setCurrentPdl: (pdl: number) => void
  setAvgPdlGain: (pdl: number) => void
  setAvgPdlLoss: (pdl: number) => void
  setCouponCode: (code: string | null) => void
  setBasePrice: (price: number) => void
  setExtrasPrice: (price: number) => void
  setEstimatedHours: (hours: number | null) => void
  setPdlModifierPct: (pct: number | null) => void
  // Pedido que o cliente escolheu explicitamente abandonar via "Sair e
  // reiniciar" (continua pagável em Meus Pedidos, só não deve mais ser
  // auto-retomado). Persistido (sobrevive a fechar aba/navegar pra Meus
  // Pedidos e voltar) -- diferente de ?new=1 na URL, que só vale pra UMA
  // visita. Fica inerte sozinho assim que esse pedido sai de
  // "awaiting_payment" (pago/cancelado/expirado): get_customer_order_state
  // nunca mais o devolve, então a comparação simplesmente para de bater.
  dismissedOrderId: string | null
  setDismissedOrderId: (id: string | null) => void
  reset: () => void
}

const INITIAL_STEPS: OrderBuilderStep[] = ['service', 'configure', 'extras', 'review', 'payment']

const initialState = {
  step: 'service' as OrderBuilderStep,
  steps: INITIAL_STEPS,
  gameSlug: 'lol' as GameSlug,
  gameId: 'lol',
  serviceType: null,
  serviceId: null,
  currentRank: null,
  targetRank: null,
  queueType: 'solo_duo' as QueueType,
  boostMode: 'solo' as BoostMode,
  server: 'BR',
  winsPurchased: null,
  sessionsPurchased: null,
  customerNotes: '',
  isMd5: false,
  md5MatchesRemaining: null as number | null,
  md5MatchesRemainingCeiling: null as number | null,
  selectedExtraIds: new Set<string>(),
  winPackage: null,
  clashTier: null as ClashTier | null,
  clashDay: null as ClashDay | null,
  preferredBoosterId: null,
  preferredBoosterName: null,
  riotId: '',
  customerLanes: [] as string[],
  riotAutoFilled: false,
  riotVerified: false,
  md5Blocked: false,
  riotLookupLoading: false,
  stepAttempted: false,
  selectedCoachPackage: null,
  currentLp: 0,
  avgLpGain: 20,
  avgLpLoss: 15,
  currentPdl: 0,
  avgPdlGain: 30,
  avgPdlLoss: 30,
  couponCode: DEFAULT_COUPON_CODE as string | null,
  basePrice: 0,
  extrasPrice: 0,
  estimatedHours: null,
  pdlModifierPct: null as number | null,
  dismissedOrderId: null as string | null,
}

// Estado "sem consulta Riot": tudo que foi derivado de uma conta consultada
// (rank atual/última temporada, LP/PDL, detecção de MD5) mais as flags de
// verificação. Reaproveitado por clearRiotLookup e setQueueType — trocar de
// fila invalida a verificação porque a Riot é consultada por fila.
const CLEARED_LOOKUP_STATE = {
  currentRank: null,
  targetRank: null,
  currentLp: 0,
  avgLpGain: 20,
  avgLpLoss: 15,
  currentPdl: 0,
  avgPdlGain: 30,
  avgPdlLoss: 30,
  riotAutoFilled: false,
  riotVerified: false,
  md5Blocked: false,
  md5MatchesRemaining: null as number | null,
  md5MatchesRemainingCeiling: null as number | null,
}

// Fluxo do configurador (solo_standard/duo_standard/master_plus) para o
// (serviço, rank atual, modalidade) combinados — null se a combinação for
// inválida (ex.: rank ainda não escolhido). Clash nunca tem rank (não usa
// currentRank) mas ainda tem fluxo — reaproveita solo_standard/duo_standard
// direto da modalidade, mesma regra de StepExtras.tsx/StepPayment.tsx.
function flowFor(serviceType: ServiceType | null, rank: Rank | null, mode: BoostMode, queueType: QueueType): BoostFlow | null {
  if (serviceType === 'clash' || serviceType === 'win_boost' || serviceType === 'md5') {
    return mode === 'duo' ? 'duo_standard' : 'solo_standard'
  }
  if (!rank) return null
  return getBoostFlow(rank.tier, mode as BoostFlowMode, queueType)
}

// Persistido em sessionStorage -- sobrevive a reload e troca de aba dentro da
// MESMA sessão do navegador (o cliente pode configurar um pedido, trocar de
// aba, voltar, e o rascunho continua lá), mas nunca sobrevive a fechar a
// aba/navegador -- diferente de localStorage, que ficaria salvo
// indefinidamente. Também é limpo explicitamente no logout (ver
// handleSignOut em UserProfilePanel.tsx) -- sem isso, um rascunho ficaria
// visível pro próximo usuário que logasse na mesma aba/computador. Continua
// limpo nos outros pontos certos do ciclo de vida (reset() roda ao confirmar
// pagamento e ao clicar em "Configurar novo pedido"/"Voltar" para começar do
// zero), então não acumula lixo indefinido mesmo dentro da sessão.
export const useOrderBuilderStore = create<OrderBuilderState>()(
  persist(
    (set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  nextStep: () => {
    const { step, steps } = get()
    const idx = steps.indexOf(step)
    if (idx < steps.length - 1) set({ step: steps[idx + 1] })
  },

  prevStep: () => {
    const { step, steps } = get()
    const idx = steps.indexOf(step)
    if (idx > 0) set({ step: steps[idx - 1] })
  },

  setGame: (gameSlug, gameId) => set({ gameSlug, gameId }),
  setServiceId: (serviceId) => set({ serviceId }),
  setService: (serviceType, serviceId) => set({
    serviceType,
    serviceId,
    // Coaching não tem addons/pacotes de vitórias -- o step "Extras" ficaria
    // vazio (só o cabeçalho), então nem entra na lista de steps.
    steps: serviceType === 'coaching' ? INITIAL_STEPS.filter((s) => s !== 'extras') : INITIAL_STEPS,
    isMd5: serviceType === 'md5',
    winsPurchased: serviceType === 'win_boost' || serviceType === 'md5' ? 5 : null,
    md5MatchesRemaining: serviceType === 'md5' ? null : null,
    md5MatchesRemainingCeiling: serviceType === 'md5' ? null : null,
    // Trocar de serviço nunca deve deixar dados de rank/tier de outra
    // modalidade vazarem pro intent -- Clash não usa rank, e nenhum outro
    // fluxo usa clashTier/clashDay.
    currentRank: null,
    targetRank: null,
    clashTier: null,
    clashDay: null,
    // Idem pra seleções específicas de UM serviço só -- sem isso, configurar
    // Coaching (escolhe pacote) ou Elo Boost (escolhe pacote de vitórias
    // extras) e depois trocar pra Vitórias mandava booster_service_id/
    // win_package pro backend, que rejeita com 400 ("Pacote de coach/de
    // vitórias extras não é aceito em Vitórias") -- um "body inválido" real,
    // não só um resíduo inofensivo no store.
    winPackage: null,
    selectedCoachPackage: null,
    sessionsPurchased: null,
    // Rotas são específicas do fluxo (elo_boost/win_boost/md5/clash) e da
    // modalidade -- trocar de serviço sempre limpa, o cliente escolhe de novo.
    customerLanes: [],
  }),

  setCurrentRank: (currentRank) => set((state) => {
    const forcedMasterPlus = isMasterPlusCurrentTier(currentRank.tier)
    // Elo Boost e Vitórias em Duo seguem a mesma regra de rank ATUAL, só na
    // fila Solo/Duo -- bloqueado assim que o rank ATUAL já é Master+, exceto
    // na Flex (a Riot não restringe duo por elo lá). MD5 nunca bloqueia Duo
    // por rank (ver orderPricing.ts).
    const duoBlocked = state.serviceType === 'elo_boost'
      ? forcedMasterPlus && state.queueType !== 'flex'
      : state.serviceType === 'win_boost' && state.queueType === 'solo_duo' && forcedMasterPlus
    const nextMode: BoostMode = duoBlocked ? 'solo' : state.boostMode
    const prevFlow = flowFor(state.serviceType, state.currentRank, state.boostMode, state.queueType)
    const nextFlow = flowFor(state.serviceType, currentRank, nextMode, state.queueType)
    const flowChanged = prevFlow !== nextFlow

    return {
      currentRank,
      boostMode: nextMode,
      // Rank alvo depende do rank atual (progressão válida muda) — sempre
      // limpo ao trocar o rank atual, o usuário escolhe de novo.
      targetRank: null,
      selectedExtraIds: flowChanged ? new Set<string>() : state.selectedExtraIds,
      winPackage: flowChanged ? null : state.winPackage,
      currentLp: forcedMasterPlus ? 0 : state.currentLp,
      currentPdl: forcedMasterPlus ? state.currentPdl : 0,
    }
  }),

  setClashCurrentRank: (currentRank, lp) => set({ currentRank, currentLp: lp }),

  setTargetRank: (targetRank) => set({ targetRank }),
  // Trocar de fila invalida a consulta anterior (rank e elegibilidade de MD5
  // são por fila) — limpa o resultado e trava o form até nova verificação.
  setQueueType: (queueType) => set({ ...CLEARED_LOOKUP_STATE, queueType }),

  setBoostMode: (boostMode) => set((state) => {
    // Elo Boost e Vitórias em Duo seguem a mesma regra de rank ATUAL, só na
    // fila Solo/Duo -- bloqueado assim que o rank ATUAL já é Master+, exceto
    // na Flex. MD5 nunca bloqueia por rank. Defesa em profundidade -- a UI
    // não deve nem oferecer essa opção nesse caso.
    if (boostMode === 'duo' && state.currentRank) {
      if (state.serviceType === 'elo_boost' && state.queueType !== 'flex' && isMasterPlusCurrentTier(state.currentRank.tier)) {
        return {}
      }
      if (state.serviceType === 'win_boost' && state.queueType === 'solo_duo' && isMasterPlusCurrentTier(state.currentRank.tier)) {
        return {}
      }
    }
    // Duo Boost chega em Master como alvo normalmente na Solo/Duo -- só
    // Grão-Mestre/Challenger como alvo bloqueia (isDuoBlockedAtTier), mesma
    // regra do backend. Se o cliente já escolheu um desses dois alvos (em
    // Solo) na fila Solo/Duo, trocar pra Duo é rejeitado aqui, mesma defesa
    // em profundidade acima. A UI trava o próprio botão (StepConfigure.tsx,
    // eloDuoBlockedByTarget).
    if (
      boostMode === 'duo' && state.serviceType === 'elo_boost' && state.queueType !== 'flex' && state.targetRank
      && isDuoBlockedAtTier(state.targetRank.tier)
    ) {
      return {}
    }
    const prevFlow = flowFor(state.serviceType, state.currentRank, state.boostMode, state.queueType)
    const nextFlow = flowFor(state.serviceType, state.currentRank, boostMode, state.queueType)
    const flowChanged = prevFlow !== nextFlow

    return {
      boostMode,
      // Addons são exclusivos por fluxo (Solo ≠ Duo ≠ Master+) — trocar a
      // modalidade remove completamente os addons incompatíveis do estado,
      // não só da tela.
      selectedExtraIds: flowChanged ? new Set<string>() : state.selectedExtraIds,
      // Rotas têm significado oposto em solo (rota pedida pro booster) e duo
      // (rota que o próprio cliente joga) -- nunca carregar de um modo pro
      // outro, o cliente escolhe de novo.
      customerLanes: boostMode !== state.boostMode ? [] : state.customerLanes,
    }
  }),

  setServer: (server) => set({ server }),
  setWinsPurchased: (winsPurchased) => set((state) => {
    const maxWins = state.isMd5 && state.md5MatchesRemaining != null
      ? Math.max(1, state.md5MatchesRemaining)
      : 5
    return { winsPurchased: Math.max(1, Math.min(winsPurchased, maxWins)) }
  }),
  setIsMd5: (isMd5) => set((state) => {
    // Toggling MD5 swaps the underlying service_type — resolved to a real
    // catalog uuid the same way StepService does (setService(slug, slug)
    // placeholder, OrderBuilderPage's catalog-service query resolves the uuid).
    const serviceType = isMd5 ? 'md5' : 'win_boost'
    return {
      isMd5,
      serviceType,
      serviceId: serviceType,
      winsPurchased: isMd5 && state.winsPurchased && state.winsPurchased > 5 ? 5 : state.winsPurchased,
      md5MatchesRemaining: isMd5 ? state.md5MatchesRemaining : null,
      md5MatchesRemainingCeiling: isMd5 ? state.md5MatchesRemainingCeiling : null,
    }
  }),
  setMd5MatchesRemaining: (md5MatchesRemaining) => set((state) => {
    const ceiling = state.md5MatchesRemainingCeiling ?? 5
    const next = Math.max(0, Math.min(md5MatchesRemaining, ceiling))
    return {
      md5MatchesRemaining: next,
      winsPurchased: state.isMd5 && state.winsPurchased != null
        ? Math.max(1, Math.min(state.winsPurchased, Math.max(1, next)))
        : state.winsPurchased,
    }
  }),
  setMd5MatchesRemainingFromApi: (n) => set(() => {
    const next = Math.max(0, Math.min(n, 5))
    return {
      md5MatchesRemaining: next,
      md5MatchesRemainingCeiling: next,
      winsPurchased: Math.max(1, next),
    }
  }),
  setSessionsPurchased: (sessionsPurchased) => set({ sessionsPurchased }),
  setNotes: (customerNotes) => set({ customerNotes }),

  toggleExtra: (extraId) =>
    set((state) => {
      const next = new Set(state.selectedExtraIds)
      if (next.has(extraId)) next.delete(extraId)
      else next.add(extraId)
      return { selectedExtraIds: next }
    }),

  setWinPackage: (winPackage) => set({ winPackage }),
  setClashTier: (clashTier) => set({ clashTier }),
  setClashDay: (clashDay) => set({ clashDay }),
  setPreferredBooster: (preferredBoosterId, preferredBoosterName) => set({ preferredBoosterId, preferredBoosterName }),
  // Único jeito de desvincular o booster escolhido -- trocar de serviço (ver
  // StepService.tsx) preserva o vínculo, só o x no banner (OrderBuilder.tsx)
  // chama isto. Limpa junto o pacote de coach (é dono do vínculo quando veio
  // de lá) pra não deixar preço/pacote de um booster que não é mais o
  // vinculado.
  clearPreferredBooster: () => set({ preferredBoosterId: null, preferredBoosterName: null, selectedCoachPackage: null }),
  // Editar o Riot ID invalida a verificação (form volta a travar) — mas NÃO
  // limpa o rank já preenchido a cada tecla; a limpeza completa acontece no
  // início da próxima busca (clearRiotLookup), pra não apagar dados enquanto
  // o usuário ainda está digitando.
  setRiotId: (riotId) => set({ riotId, riotAutoFilled: false, riotVerified: false, md5Blocked: false }),
  setCustomerLanes: (customerLanes) => set({ customerLanes: customerLanes.slice(0, 2) }),
  setRiotAutoFilled: (riotAutoFilled) => set({ riotAutoFilled }),
  setRiotVerified: (riotVerified) => set({ riotVerified }),
  setMd5Blocked: (md5Blocked) => set({ md5Blocked }),
  clearRiotLookup: () => set({ ...CLEARED_LOOKUP_STATE }),
  setRiotLookupLoading: (riotLookupLoading) => set({ riotLookupLoading }),
  setStepAttempted: (stepAttempted) => set({ stepAttempted }),
  setSelectedCoachPackage: (selectedCoachPackage) => set({ selectedCoachPackage }),

  setCurrentLp: (currentLp) => set((state) => state.currentLp === currentLp ? state : { currentLp }),
  setAvgLpGain: (avgLpGain) => set((state) => state.avgLpGain === avgLpGain ? state : { avgLpGain }),
  setAvgLpLoss: (avgLpLoss) => set((state) => state.avgLpLoss === avgLpLoss ? state : { avgLpLoss }),
  setCurrentPdl: (currentPdl) => set((state) => state.currentPdl === currentPdl ? state : { currentPdl }),
  setAvgPdlGain: (avgPdlGain) => set((state) => state.avgPdlGain === avgPdlGain ? state : { avgPdlGain }),
  setAvgPdlLoss: (avgPdlLoss) => set((state) => state.avgPdlLoss === avgPdlLoss ? state : { avgPdlLoss }),
  setCouponCode: (couponCode) => set((state) => state.couponCode === couponCode ? state : { couponCode }),
  setBasePrice: (basePrice) => set((state) => state.basePrice === basePrice ? state : { basePrice }),
  setExtrasPrice: (extrasPrice) => set((state) => state.extrasPrice === extrasPrice ? state : { extrasPrice }),
  setEstimatedHours: (estimatedHours) => set((state) => state.estimatedHours === estimatedHours ? state : { estimatedHours }),
  setPdlModifierPct: (pdlModifierPct) => set((state) => state.pdlModifierPct === pdlModifierPct ? state : { pdlModifierPct }),
  setDismissedOrderId: (dismissedOrderId) => set({ dismissedOrderId }),

  reset: () => set({ ...initialState, selectedExtraIds: new Set<string>() }),
    }),
    {
      name: 'eloboost-order-builder',
      storage: createJSONStorage(() => sessionStorage, {
        // Set não é serializável em JSON puro -- codifica/decodifica
        // explicitamente (selectedExtraIds é o único Set no estado).
        replacer: (_key, value) => (value instanceof Set ? { __set: [...value] } : value),
        reviver: (_key, value) =>
          value && typeof value === 'object' && '__set' in (value as Record<string, unknown>)
            ? new Set((value as { __set: string[] }).__set)
            : value,
      }),
      // Só os dados do pedido em construção -- exclui riotLookupLoading (flag
      // transiente de "consulta em andamento") pra nunca restaurar travado
      // num loading que não existe mais depois de um reload.
      partialize: (state) => {
        const { riotLookupLoading: _riotLookupLoading, ...persisted } = state
        return persisted
      },
    },
  ),
)
