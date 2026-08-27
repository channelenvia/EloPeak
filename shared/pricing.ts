// Módulo de preço — fonte única de verdade, compartilhada entre o frontend
// (Vite/React, para exibir estimativas antes do envio) e a Edge Function
// create-pix-payment (Deno, para computar o preço autoritativo do pedido).
//
// Por rodar nos dois runtimes, este arquivo não pode importar nada de
// `@/...` (alias do Vite) nem de APIs específicas de browser ou Deno —
// apenas TypeScript puro.

export type RankTier =
  | 'iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'emerald'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'challenger'

export type Division = 'I' | 'II' | 'III' | 'IV'

export type ServiceType = 'elo_boost' | 'win_boost' | 'placement_matches' | 'coaching' | 'md5' | 'clash'

export const RANK_TIER_ORDER: RankTier[] = [
  'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger',
]

const DIVISIONS_ORDER: Division[] = ['IV', 'III', 'II', 'I']

export function moneyToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new RangeError('Invalid monetary value')
  }
  return Math.round(value * 100)
}

export function centsToMoney(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Invalid cent value')
  return cents / 100
}

function percentageOfCents(cents: number, percentage: number): number {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new RangeError('Invalid percentage')
  }
  return Math.round(cents * percentage / 100)
}

function isMasterPlus(tier: RankTier): tier is 'master' | 'grandmaster' | 'challenger' {
  return tier === 'master' || tier === 'grandmaster' || tier === 'challenger'
}

// Sequential step index: Iron IV = 0 … Diamond I = 27, Master = 28, GM = 29, Chall = 30
export function rankStep(tier: RankTier, div: Division | null): number {
  if (tier === 'master') return 28
  if (tier === 'grandmaster') return 29
  if (tier === 'challenger') return 30
  const ti = RANK_TIER_ORDER.indexOf(tier)
  const di = div ? DIVISIONS_ORDER.indexOf(div) : 0
  return ti * 4 + di
}

export type QueueType = 'solo_duo' | 'flex'

// ── Elo Boost — preço por divisão ao ENTRAR em cada tier, em CENTAVOS ───────
// Tabela oficial por fila. Master+ não usa esta tabela — vem de
// `master_plus_pricing` no banco (ver shared/boostDomain.ts e a migration
// que cria essa tabela).
const ELO_DIV_PRICE_CENTS: Record<QueueType, Record<string, number>> = {
  solo_duo: {
    iron: 1105, bronze: 1287, silver: 1755, gold: 2197,
    platinum: 3107, emerald: 6097, diamond: 9737,
  },
  flex: {
    iron: 1105, bronze: 1287, silver: 1755, gold: 2197,
    platinum: 3107, emerald: 6097, diamond: 9737,
  },
}

// Tabela usada só pela página pública de preços (sem seleção de fila) —
// reflete a fila solo_duo, a padrão exibida antes do configurador.
export const ELO_TIERS: { tier: RankTier; perDiv: number }[] = [
  { tier: 'iron',     perDiv: 11.05 },
  { tier: 'bronze',   perDiv: 12.87 },
  { tier: 'silver',   perDiv: 17.55 },
  { tier: 'gold',     perDiv: 21.97 },
  { tier: 'platinum', perDiv: 31.07 },
  { tier: 'emerald',  perDiv: 60.97 },
  { tier: 'diamond',  perDiv: 97.37 },
]

const TIER_NAMES = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond']

export function getEloDivPrice(queue: QueueType, tier: RankTier): number {
  return centsToMoney(ELO_DIV_PRICE_CENTS[queue][tier] ?? ELO_DIV_PRICE_CENTS[queue].diamond)
}

function divPriceCentsForStep(queue: QueueType, step: number): number {
  const ti = Math.min(Math.floor(step / 4), 6)
  return ELO_DIV_PRICE_CENTS[queue][TIER_NAMES[ti]] ?? ELO_DIV_PRICE_CENTS[queue].diamond
}

// Degrau de "entrar em Mestre" (rankStep('master', null)) -- calcEloPrice
// nunca cobra por divisão além dele. O trecho Mestre->Grão-Mestre/Challenger
// tem preço próprio, por PDL (master_plus_pricing, ver computeOrderPrice),
// não a taxa fixa de divisão do Diamond repetida pros degraus 29/30.
const MASTER_STEP = 28

export function calcEloPrice(
  queue: QueueType,
  fTier: RankTier, fDiv: Division | null,
  tTier: RankTier, tDiv: Division | null,
): { price: number } {
  const from = rankStep(fTier, fDiv)
  const to = Math.min(rankStep(tTier, tDiv), MASTER_STEP)
  if (to <= from) return { price: 0 }

  let priceCents = 0
  for (let s = from + 1; s <= to; s++) priceCents += divPriceCentsForStep(queue, s)

  return { price: centsToMoney(priceCents) }
}

// ── Vitória Avulsa (Win Boost) — preço por vitória, em CENTAVOS ─────────────
const WIN_PRICE_CENTS: Record<QueueType, Record<string, number>> = {
  solo_duo: {
    iron: 377, bronze: 377, silver: 507, gold: 507, platinum: 897,
    emerald: 1287, diamond: 2067, master: 5837, grandmaster: 7787, challenger: 12987,
  },
  flex: {
    iron: 377, bronze: 377, silver: 507, gold: 507, platinum: 897,
    emerald: 1287, diamond: 2067, master: 5253, grandmaster: 7008, challenger: 11688,
  },
}

export const MATCH_DURATION_HOURS = 0.5
// Fonte única de verdade do prazo de entrega mostrado ao cliente. A
// estimativa de horas de jogo puro (estimateEloBoostHours / partidas * 0.5h)
// nunca reflete a realidade — booster também dorme, tem outros pedidos, faz
// pausas. Multiplicamos por 10 aqui, uma única vez, no fechamento de
// computeOrderPrice() — nunca no frontend, nunca em cada serviceType
// separadamente. Aplica-se a TODO pedido medido em partidas (win_boost,
// md5, placement_matches e elo_boost — tanto o fluxo padrão com LP médio
// quanto o Master+ com PDL médio); coaching é a única exceção, pois usa a
// duração real do pacote/sessões, não contagem de partidas.
export const DELIVERY_ESTIMATE_MULTIPLIER = 10
export const EXPECTED_BOOST_WIN_RATE = 0.8
export const MASTER_PLUS_LP_PER_GAME = 30
export const MASTER_PLUS_TARGET_LP: Record<'master' | 'grandmaster' | 'challenger', number> = {
  master: 0,
  grandmaster: 1_200,
  challenger: 2_200,
}

const MASTER_START_ABSOLUTE_LP = MASTER_STEP * 100

// Corte real (PDL do último colocado) das ligas Grão-Mestre/Challenger na
// Riot, quando disponível (riot_league_cutoffs, atualizado pela edge
// function riot-league-cutoffs) -- substitui os alvos fixos de
// MASTER_PLUS_TARGET_LP na estimativa de prazo. Nunca afeta o preço (fixo
// por tier -- migration 028), só a estimativa de horas.
export interface MasterPlusCutoffs {
  grandmaster?: number | null
  challenger?: number | null
}

function masterPlusTargetLp(
  tier: 'master' | 'grandmaster' | 'challenger',
  liveCutoffs?: MasterPlusCutoffs,
): number {
  if (tier === 'grandmaster' && liveCutoffs?.grandmaster != null) return liveCutoffs.grandmaster
  if (tier === 'challenger' && liveCutoffs?.challenger != null) return liveCutoffs.challenger
  return MASTER_PLUS_TARGET_LP[tier]
}

// Partidas de 30 PDL até ULTRAPASSAR o corte -- nunca parar exatamente NO
// corte (empatar com o último colocado da liga não garante a promoção). O
// ganho é sempre quantizado em MASTER_PLUS_LP_PER_GAME, então "passar o
// corte" na prática é parar no primeiro múltiplo de 30 acima dele. Já começa
// acima do corte (pedido raro/quase concluído) não precisa de partida
// nenhuma pra esse trecho.
function gamesToPassMasterPlusCutoff(currentPdl: number, cutoffLp: number): number {
  if (currentPdl > cutoffLp) return 0
  return Math.floor((cutoffLp - currentPdl) / MASTER_PLUS_LP_PER_GAME) + 1
}

// Partidas esperadas pra fechar N vitórias líquidas no win rate do serviço
// (mesma taxa usada no LP médio do Elo Boost) -- nem toda partida jogada é
// uma vitória, então o número de partidas é sempre maior que o de vitórias
// compradas.
export function expectedMatchesForWins(winsNeeded: number): number {
  return Math.ceil(winsNeeded / EXPECTED_BOOST_WIN_RATE)
}

/**
 * Estima somente tempo efetivo de jogo. Abaixo de Master, percorre os 100 LP
 * de cada divisão e considera ganho/perda esperados com 80% de win rate do
 * serviço. Em Master+, usa a progressão fixa de 30 PDL por partida definida
 * pelo produto, até ultrapassar o corte atual de GM/Challenger
 * (masterPlusCutoffs, com fallback pros alvos fixos de MASTER_PLUS_TARGET_LP
 * quando indisponível).
 */
export function estimateEloBoostHours(input: {
  currentRank: { tier: RankTier; division: Division | null }
  targetRank: { tier: RankTier; division: Division | null }
  currentLp: number
  avgLpGain: number
  avgLpLoss: number
  currentPdl: number | null
  masterPlusCutoffs?: MasterPlusCutoffs
}): number | null {
  const { currentRank, targetRank, currentLp, avgLpGain, avgLpLoss } = input
  const fromStep = rankStep(currentRank.tier, currentRank.division)
  const toStep = rankStep(targetRank.tier, targetRank.division)
  if (toStep <= fromStep) return null

  if (![currentLp, avgLpGain, avgLpLoss].every(Number.isFinite)
      || currentLp < 0 || currentLp > 100 || avgLpGain <= 0 || avgLpLoss <= 0) {
    throw new RangeError('Invalid LP values for delivery estimate')
  }

  let standardGames = 0
  let masterPlusGames = 0

  if (!isMasterPlus(currentRank.tier)) {
    const currentAbsoluteLp = fromStep * 100 + currentLp
    const standardTargetLp = isMasterPlus(targetRank.tier)
      ? MASTER_START_ABSOLUTE_LP
      : toStep * 100
    const requiredStandardLp = Math.max(0, standardTargetLp - currentAbsoluteLp)
    const expectedNetLpPerGame = Math.max(
      1,
      avgLpGain * EXPECTED_BOOST_WIN_RATE - avgLpLoss * (1 - EXPECTED_BOOST_WIN_RATE),
    )
    standardGames = Math.ceil(requiredStandardLp / expectedNetLpPerGame)

    if (isMasterPlus(targetRank.tier)) {
      // Entra em Master com 0 PDL (mesma referência de MASTER_START_ABSOLUTE_LP
      // acima) e sobe de 30 em 30 até passar o corte de GM/Challenger.
      masterPlusGames = gamesToPassMasterPlusCutoff(0, masterPlusTargetLp(targetRank.tier, input.masterPlusCutoffs))
    }
  } else {
    if (!isMasterPlus(targetRank.tier)) return null
    const currentMasterPlusLp = Math.max(0, input.currentPdl ?? 0)
    masterPlusGames = gamesToPassMasterPlusCutoff(currentMasterPlusLp, masterPlusTargetLp(targetRank.tier, input.masterPlusCutoffs))
  }

  const games = standardGames + masterPlusGames
  return games > 0 ? games * MATCH_DURATION_HOURS : null
}

// ── Cupom de desconto ────────────────────────────────────────────────────────
// Mesmo padrão das tabelas hardcoded acima (WIN_PACKAGE_DISCOUNTS/
// MD5_DISCOUNT_PCT): whitelist fixa em código, não uma tabela editável em
// runtime. O cliente só envia o CÓDIGO digitado -- o percentual de desconto
// nunca vem do cliente, é sempre resolvido aqui contra esta lista. Qualquer
// código fora dela (typo, cupom expirado inventado, string arbitrária)
// resulta em desconto zero, nunca em erro -- o pedido segue sem desconto.
interface CouponDefinition {
  discountPct: number
}

const VALID_COUPONS: Record<string, CouponDefinition> = Object.freeze({
  ELOPEAK30: { discountPct: 30 },
})

// Cupom fixo aplicado automaticamente pelo order-builder (StepReview/
// OrderBuilder) -- o cliente não digita mais nada, só vê o desconto já
// ativo. Continua passando pelo mesmo applyCoupon() de sempre (mesma
// validação server-side em create-pix-payment), só a UI de "digitar cupom"
// que sai de cena.
export const DEFAULT_COUPON_CODE = 'ELOPEAK30'

export const DEFAULT_COUPON_DISCOUNT_PCT = VALID_COUPONS[DEFAULT_COUPON_CODE].discountPct

// Todo serviço com preço de tabela aceita cupom. Só Coaching fica de fora --
// preço já vem do pacote que o próprio booster cadastra, não da tabela de
// preços do produto (nada pra descontar contra o catálogo). placement_matches
// (legado) não entra porque não é mais oferecido como serviço novo.
export const COUPON_ELIGIBLE_SERVICE_TYPES: ServiceType[] = ['elo_boost', 'win_boost', 'md5', 'clash']

export interface CouponOutcome {
  couponApplied: boolean
  discountPct: number
  discountPrice: number
}

const NO_DISCOUNT: CouponOutcome = { couponApplied: false, discountPct: 0, discountPrice: 0 }

// Resolve um código de cupom contra a subtotal (basePrice + extrasPrice) já
// calculada. Case-sensitive de propósito -- só o texto exato cadastrado em
// VALID_COUPONS (ex.: "ELOPEAK30") aplica; "elopeak30"/"Elopeak30" não batem.
// `Object.prototype.hasOwnProperty.call` em vez de `in`/acesso direto --
// evita que um código como "__proto__" ou "constructor" resolva para algo
// herdado de Object.prototype em vez de "não encontrado".
export function applyCoupon(subtotal: number, code: string | null | undefined, serviceType: ServiceType): CouponOutcome {
  if (!code) return NO_DISCOUNT
  const normalized = code.trim()
  if (!normalized || normalized.length > 32) return NO_DISCOUNT
  if (!Object.prototype.hasOwnProperty.call(VALID_COUPONS, normalized)) return NO_DISCOUNT
  if (!COUPON_ELIGIBLE_SERVICE_TYPES.includes(serviceType)) return NO_DISCOUNT

  const { discountPct } = VALID_COUPONS[normalized]
  const subtotalCents = moneyToCents(subtotal)
  const discountCents = percentageOfCents(subtotalCents, discountPct)
  return { couponApplied: true, discountPct, discountPrice: centsToMoney(discountCents) }
}

const WIN_PACKAGE_DISCOUNTS: Record<number, number> = { 1: 10, 3: 20, 5: 30 }

export function getWinBoostPrice(queue: QueueType, tier: RankTier, _div?: Division | null): number {
  return centsToMoney(WIN_PRICE_CENTS[queue][tier] ?? WIN_PRICE_CENTS[queue].diamond)
}

// ── MD5 — garantia de win rate, preço por vitória líquida ──────────────────
// Derivado do preço da Vitória Avulsa (mesma fila/tier) com 50% de desconto —
// não é mais uma tabela independente. O pacote cheio de 5 partidas de
// placement é só 5× esse preço por vitória; comprar menos vitórias (4, 3...)
// desconta proporcionalmente, nunca cobra o pacote inteiro (a soma acontece
// em computeOrderPrice, multiplicando por winsPurchased).
export const MD5_DISCOUNT_PCT = 50

export function getMd5WinPrice(queue: QueueType, tier: RankTier): number {
  const winPriceCents = moneyToCents(getWinBoostPrice(queue, tier))
  return centsToMoney(Math.round(winPriceCents * (1 - MD5_DISCOUNT_PCT / 100)))
}

export type ClashTier = 'tier_4' | 'tier_3' | 'tier_2' | 'tier_1'
export type ClashDay = 'saturday' | 'sunday'

// ── Clash — preço fixo por modalidade × tier, em CENTAVOS ──────────────────
// Diferente do Elo Boost: não há origem/destino, o cliente só escolhe o
// tier correspondente ao elo atual da conta (ver shared/clashDomain.ts para
// o mapeamento tier -> faixa de RankTier).
export const CLASH_PRICE_CENTS: Record<'solo' | 'duo', Record<ClashTier, number>> = {
  solo: { tier_4: 2600, tier_3: 4407, tier_2: 5187, tier_1: 8450 },
  duo: { tier_4: 7787, tier_3: 8697, tier_2: 13000, tier_1: 21567 },
}

export function getClashBasePrice(mode: 'solo' | 'duo', tier: ClashTier): number {
  return centsToMoney(CLASH_PRICE_CENTS[mode][tier])
}

// Duração fixa de uma "noite de Clash" (o pedido já tem um dia agendado —
// sábado/domingo — não uma progressão medida em partidas), então nunca passa
// pelo DELIVERY_ESTIMATE_MULTIPLIER abaixo — mesma razão da exceção do
// coaching (duração real do compromisso, não estimativa de jogo puro).
export const CLASH_ESTIMATED_HOURS = 4

// ── MD5 Completo (placement_matches) — legado, mantido só para pedidos
// antigos e cálculo de preço histórico. Não oferecido como serviço novo
// (StepService.tsx não lista mais este tile) — ver Task 6.
export const PLACEMENT_PRICE: Record<string, number> = {
  iron: 14.90, bronze: 16.90, silver: 18.90, gold: 21.90,
  platinum: 30.90, emerald: 37.90, diamond: 41.90,
  master: 59.90, grandmaster: 99.90, challenger: 179.90,
}

// ── Elo Boost Master+ — resumo pra página pública de preços ─────────────────
// Fonte de referência apenas — o preço autoritativo do pedido vem da tabela
// `master_plus_pricing` (ver migration 099), chaveada por (tier atual, tier
// alvo, fila, faixa de PDL). Cada chave aqui é o preço do PRIMEIRO degrau de
// PDL (0 do tier atual) daquela progressão — mesmo significado usado pelas
// linhas de Iron–Diamond (preço "tier completo" partindo daquele tier), não
// um custo acumulado desde Mestre:
//   master      -> avançar de Mestre para Grão-Mestre     (R$ 1.169,87)
//   grandmaster -> avançar de Grão-Mestre para Challenger (R$ 1.624,87)
//   challenger  -> Mestre->Challenger direto (pula Grão-Mestre), soma dos
//                  dois primeiros degraus acima — único caso sem "tier
//                  atual == linha", mantido só como referência (não é
//                  exibido na página pública hoje)                (R$ 2.794,74)
export const MASTER_PLUS_TIER_PRICE_CENTS: Record<'master' | 'grandmaster' | 'challenger', number> = {
  master: 116987,
  grandmaster: 162487,
  challenger: 279474,
} as const

// ── Duo Boost — percentual sobre o elo boost ──────────────────────────────────
// Duo Boost só existe para o fluxo padrão (Iron–Diamond) — Master+ não aceita
// Duo (ver shared/boostDomain.ts::getBoostFlow). Este percentual nunca é
// aplicado a um preço de Master+.
export const DUO_BOOST_PCT = 50

// ── Master+ — preço vem da tabela comercial `master_plus_pricing` ───────────
// Não existe fórmula de LP-alvo para Master+: o preço é definido pela regra
// comercial (origem × destino × faixa de PDL atual), consultada no banco
// pela Edge Function e repassada para computeOrderPrice via
// `input.masterPlusPrice`. Ver shared/boostDomain.ts (PDL_BRACKETS,
// MASTER_PLUS_PROGRESSIONS) e a migration que cria `master_plus_pricing`.

// ── LP Modifier for Iron–Diamond ──────────────────────────────────────────────
// Percentual de eficiência aplicado conforme a média de LP por partida —
// função isolada para que `applyLpModifier` e `computeOrderPrice` consultem
// os mesmos limiares (19/20/25/26) sem duas checagens independentes
// divergirem no futuro.
export function lpModifierPct(avgLpPerGame: number): number {
  if (avgLpPerGame < 20) return 15
  if (avgLpPerGame > 25) return -5
  return 0
}

// ── Master+ — desconto do trecho Mestre 0PDL→alvo ───────────────────────────
// Determinístico, nunca depende de média real vinda da Riot: a progressão
// comercial do trecho Master+ é sempre 30 PDL/vitória (MASTER_PLUS_LP_PER_GAME),
// então o número de vitórias necessárias é o mesmo já usado pra estimar prazo
// (gamesToPassMasterPlusCutoff). Cada vitória desconta 5% do preço da Vitória
// Avulsa NO RANK ATUAL da conta (Diamond, Mestre, Grão-Mestre...) -- mesma
// regra tanto pra quem já está em Mestre+ quanto pro trecho Mestre->alvo de
// quem vem de Diamond- (current_pdl sempre 0 nesse caso) -- nunca deixa o
// preço final negativo.
export const MASTER_PLUS_PDL_WIN_VALUE_PCT = 5

export function applyMasterPlusPdlDiscount(
  basePrice: number,
  targetTier: 'grandmaster' | 'challenger',
  currentPdl: number,
  currentTier: RankTier,
  queue: QueueType,
  masterPlusCutoffs?: MasterPlusCutoffs,
): number {
  if (basePrice <= 0) return basePrice
  const clampedPdl = Math.max(0, currentPdl)
  const targetLp = masterPlusTargetLp(targetTier, masterPlusCutoffs)
  const distance = targetLp - clampedPdl
  if (distance <= 0) return basePrice
  const winsNeeded = gamesToPassMasterPlusCutoff(clampedPdl, targetLp)
  if (winsNeeded <= 0) return basePrice

  const baseCents = moneyToCents(basePrice)
  const winValueCents = moneyToCents(getWinBoostPrice(queue, currentTier))
  const decrementCents = Math.round(winsNeeded * winValueCents * (MASTER_PLUS_PDL_WIN_VALUE_PCT / 100))
  const cappedDecrementCents = Math.min(Math.max(0, decrementCents), baseCents)
  return centsToMoney(baseCents - cappedDecrementCents)
}

export function applyLpModifier(
  basePrice: number,
  fTier: RankTier,
  currentLp: number,
  avgLpPerGame: number,
  _avgLpLoss?: number,
  queueType: QueueType = 'solo_duo',
): number {
  if (basePrice <= 0) return 0
  if (![currentLp, avgLpPerGame].every(Number.isFinite)
      || currentLp < 0 || currentLp > 100 || avgLpPerGame <= 0) {
    throw new RangeError('Invalid LP values')
  }
  const baseCents = moneyToCents(basePrice)
  const divPriceCents = moneyToCents(getEloDivPrice(queueType, fTier))
  const lpDiscountCents = Math.round(currentLp * divPriceCents / 100)
  const pct = lpModifierPct(avgLpPerGame)
  const efficiencyMod = 1 + pct / 100
  return centsToMoney(Math.max(0, Math.round((baseCents - lpDiscountCents) * efficiencyMod)))
}

// ── Preço autoritativo do pedido ──────────────────────────────────────────────
// Único ponto que decide quanto um pedido custa. Usado pelo frontend só para
// exibir uma estimativa (StepConfigure/StepExtras/StepReview); a Edge
// Function create-pix-payment é quem chama isso de fato para gravar
// base_price/extras_price/total_price em `orders` — o cliente nunca envia
// preço, só a intenção (rank, extras selecionados, pacote de vitórias etc).

export interface RankValue {
  tier: RankTier
  division: Division | null
}

interface OrderExtraInput {
  id: string
  priceModifier: number
  priceModifierPct: number
}

export interface OrderPriceInput {
  serviceType: ServiceType
  queueType: QueueType
  boostMode: 'solo' | 'duo'
  currentRank: RankValue | null
  targetRank: RankValue | null
  currentLp: number
  avgLpGain: number
  avgLpLoss: number
  currentPdl: number | null
  // Progressão comercial fixa de 30 PDL/vitória (MASTER_PLUS_LP_PER_GAME) --
  // só preenchida quando o rank ATUAL já é Master+/GM/Challenger. Usada
  // apenas pra registro/estimativa de progresso do pedido (orders.avg_pdl_gain),
  // nunca entra no cálculo de preço -- applyMasterPlusPdlDiscount é
  // determinístico e não depende deste campo.
  avgPdlGain: number | null
  // Preço já consultado em `master_plus_pricing` para a combinação (origem,
  // destino, fila, degrau de PDL atual) — null quando a faixa ainda não tem
  // preço configurado (pedido deve ser bloqueado, nunca com valor
  // inventado). Usado tanto quando o rank ATUAL já é Master+/Grão-Mestre
  // (preço total do pedido) quanto no fluxo padrão mirando Grão-Mestre/
  // Challenger a partir de Diamond- (somado ao preço por divisão até
  // Mestre). Ignorado para qualquer outro serviceType/alvo.
  masterPlusPrice: number | null
  // Corte atual (PDL do último colocado) das ligas GM/Challenger na Riot,
  // quando disponível — ver MasterPlusCutoffs. Afeta só estimatedHours,
  // nunca o preço.
  masterPlusCutoffs?: MasterPlusCutoffs
  winsPurchased: number | null
  sessionsPurchased: number | null
  extras: OrderExtraInput[]
  winPackage: 1 | 3 | 5 | null
  // Tier fixo escolhido pelo cliente (Clash) — null pra qualquer outro
  // serviceType. Ignorado fora do case 'clash' em computeOrderPrice.
  clashTier: ClashTier | null
  // Preço do pacote de coach escolhido (booster_services.price),
  // já validado server-side contra o booster_service_id do intent — nunca
  // inventado. Ignorado para qualquer serviceType que não seja 'coaching'.
  coachPackagePrice: number | null
  // Código de cupom digitado pelo cliente — nunca um percentual/valor de
  // desconto. O percentual é sempre resolvido contra a whitelist fixa em
  // applyCoupon(), nunca aceito do cliente. Ignorado (sem efeito) para
  // serviceType fora de COUPON_ELIGIBLE_SERVICE_TYPES (ex.: coaching).
  couponCode: string | null
}

export interface OrderPriceResult {
  basePrice: number
  extrasPrice: number
  totalPrice: number
  estimatedHours: number | null
  winPackagePrice: number
  extrasBreakdown: { id: string; price: number }[]
  // Percentual de modificador de PDL efetivamente aplicado (-5, 0 ou +15) —
  // só existe no fluxo padrão elo_boost (Iron–Diamond); `null` para Master+
  // e para qualquer outro serviceType, onde este modificador nunca se aplica.
  pdlModifierPct: number | null
  // Resultado da resolução do cupom (ver applyCoupon) — discountPrice sempre
  // 0 quando não há cupom válido/aplicável, nunca negativo, nunca maior que
  // basePrice + extrasPrice.
  couponApplied: boolean
  discountPct: number
  discountPrice: number
}

export function computeOrderPrice(input: OrderPriceInput): OrderPriceResult {
  if (input.extras.length > 20) throw new RangeError('Too many extras')
  for (const extra of input.extras) {
    moneyToCents(extra.priceModifier)
    if (!Number.isFinite(extra.priceModifierPct) || extra.priceModifierPct < 0 || extra.priceModifierPct > 100) {
      throw new RangeError('Invalid extra percentage')
    }
  }
  let basePrice = 0
  let estimatedHours: number | null = null
  let pdlModifierPct: number | null = null

  switch (input.serviceType) {
    case 'elo_boost': {
      const { currentRank, targetRank, boostMode, currentLp, avgLpGain, avgLpLoss } = input
      if (!currentRank) break

      if (isMasterPlus(currentRank.tier)) {
        // Master+ não aceita Duo — basePrice fica 0 (bloqueado) se boostMode
        // vier 'duo' aqui; a rejeição explícita acontece antes disso, na
        // validação de fluxo (getBoostFlow retorna null para essa combinação).
        // O modificador de PDL nunca se aplica ao Master+ — pdlModifierPct
        // permanece null.
        if (boostMode === 'duo' || input.masterPlusPrice == null) break
        basePrice = centsToMoney(moneyToCents(input.masterPlusPrice))
        if (targetRank) {
          basePrice = applyMasterPlusPdlDiscount(
            basePrice,
            targetRank.tier as 'grandmaster' | 'challenger',
            input.currentPdl ?? 0,
            currentRank.tier,
            input.queueType,
            input.masterPlusCutoffs,
          )
          estimatedHours = estimateEloBoostHours({
            currentRank,
            targetRank,
            currentLp: 0,
            avgLpGain: MASTER_PLUS_LP_PER_GAME,
            avgLpLoss: MASTER_PLUS_LP_PER_GAME,
            currentPdl: input.currentPdl,
            masterPlusCutoffs: input.masterPlusCutoffs,
          })
        }
      } else {
        if (!targetRank) break
        const { price } = calcEloPrice(
          input.queueType,
          currentRank.tier, currentRank.division,
          targetRank.tier, targetRank.division,
        )
        const withLp = applyLpModifier(price, currentRank.tier, currentLp, avgLpGain, avgLpLoss, input.queueType)
        let combinedCents = moneyToCents(withLp)

        // Diamond- mirando Grão-Mestre/Challenger direto: calcEloPrice acima
        // já parou em Mestre (MASTER_STEP) -- o trecho Mestre->alvo soma o
        // preço por PDL de master_plus_pricing (sempre no PDL=0, quem vem do
        // fluxo padrão entra em Mestre do zero). "master" como alvo exato
        // não entra aqui: já está totalmente coberto pelo calcEloPrice acima.
        if (targetRank.tier === 'grandmaster' || targetRank.tier === 'challenger') {
          if (input.masterPlusPrice == null) { basePrice = 0; break }
          const discountedMasterPlusPrice = applyMasterPlusPdlDiscount(
            input.masterPlusPrice,
            targetRank.tier,
            0,
            currentRank.tier,
            input.queueType,
            input.masterPlusCutoffs,
          )
          combinedCents += moneyToCents(discountedMasterPlusPrice)
        }

        basePrice = boostMode === 'duo'
          ? centsToMoney(combinedCents + percentageOfCents(combinedCents, DUO_BOOST_PCT))
          : centsToMoney(combinedCents)
        estimatedHours = estimateEloBoostHours({
          currentRank,
          targetRank,
          currentLp,
          avgLpGain,
          avgLpLoss,
          currentPdl: null,
          masterPlusCutoffs: input.masterPlusCutoffs,
        })
        pdlModifierPct = lpModifierPct(avgLpGain)
      }
      break
    }
    case 'placement_matches': {
      if (!input.currentRank) break
      basePrice = PLACEMENT_PRICE[input.currentRank.tier] ?? 15
      estimatedHours = 5 * MATCH_DURATION_HOURS
      break
    }
    case 'win_boost': {
      if (!input.winsPurchased || !input.currentRank) break
      if (input.winsPurchased < 1 || input.winsPurchased > 5) break
      const pricePerWin = getWinBoostPrice(input.queueType, input.currentRank.tier, input.currentRank.division)
      const winsCents = input.winsPurchased * moneyToCents(pricePerWin)
      basePrice = input.boostMode === 'duo'
        ? centsToMoney(winsCents + percentageOfCents(winsCents, DUO_BOOST_PCT))
        : centsToMoney(winsCents)
      estimatedHours = expectedMatchesForWins(input.winsPurchased) * MATCH_DURATION_HOURS
      break
    }
    case 'md5': {
      if (!input.winsPurchased || !input.currentRank) break
      if (input.winsPurchased < 1 || input.winsPurchased > 5) break
      const pricePerWin = getMd5WinPrice(input.queueType, input.currentRank.tier)
      const winsCents = input.winsPurchased * moneyToCents(pricePerWin)
      basePrice = input.boostMode === 'duo'
        ? centsToMoney(winsCents + percentageOfCents(winsCents, DUO_BOOST_PCT))
        : centsToMoney(winsCents)
      estimatedHours = expectedMatchesForWins(input.winsPurchased) * MATCH_DURATION_HOURS
      break
    }
    case 'coaching': {
      basePrice = input.coachPackagePrice ?? 0
      estimatedHours = input.sessionsPurchased ?? 1
      break
    }
    case 'clash': {
      if (!input.clashTier) break
      basePrice = getClashBasePrice(input.boostMode, input.clashTier)
      estimatedHours = CLASH_ESTIMATED_HOURS
      break
    }
  }

  const basePriceCents = moneyToCents(basePrice)
  const extrasBreakdown = input.extras.map((e) => ({
    id: e.id,
    price: centsToMoney(e.priceModifier > 0
      ? moneyToCents(e.priceModifier)
      : e.priceModifierPct > 0
        ? percentageOfCents(basePriceCents, e.priceModifierPct)
        : 0),
  }))

  const extrasRawCents = extrasBreakdown.reduce((sum, e) => sum + moneyToCents(e.price), 0)

  let winPackagePrice = 0
  if (input.winPackage && input.currentRank) {
    const pricePerWin = getWinBoostPrice(input.queueType, input.currentRank.tier, input.currentRank.division)
    const discountPct = WIN_PACKAGE_DISCOUNTS[input.winPackage] ?? 0
    const undiscountedCents = moneyToCents(pricePerWin) * input.winPackage
    winPackagePrice = centsToMoney(undiscountedCents - percentageOfCents(undiscountedCents, discountPct))
  }

  if (estimatedHours != null && input.winPackage) {
    estimatedHours += expectedMatchesForWins(input.winPackage) * MATCH_DURATION_HOURS
  }

  // Prazo real de entrega: dobra a estimativa de horas de jogo puro. Só se
  // aplica a serviços cuja duração é calculada em partidas; coaching continua
  // usando a duração real do pacote/sessões (não é jogo ranqueado).
  if (estimatedHours != null && input.serviceType !== 'coaching' && input.serviceType !== 'clash') {
    estimatedHours *= DELIVERY_ESTIMATE_MULTIPLIER
  }

  const extrasPriceCents = extrasRawCents + moneyToCents(winPackagePrice)
  const extrasPrice = centsToMoney(extrasPriceCents)
  const subtotalCents = basePriceCents + extrasPriceCents

  const coupon = applyCoupon(centsToMoney(subtotalCents), input.couponCode, input.serviceType)
  const totalPrice = centsToMoney(subtotalCents - moneyToCents(coupon.discountPrice))

  return {
    basePrice, extrasPrice, totalPrice, estimatedHours, winPackagePrice, extrasBreakdown, pdlModifierPct,
    couponApplied: coupon.couponApplied, discountPct: coupon.discountPct, discountPrice: coupon.discountPrice,
  }
}
