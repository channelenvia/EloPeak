import { z } from 'https://esm.sh/zod@3.23.8'
import { computeOrderPrice, rankStep, type MasterPlusCutoffs, type OrderPriceInput, type RankValue, type ServiceType, type ClashTier, type ClashDay } from '../../../shared/pricing.ts'
import {
  type BoostFlow,
  isAddonCodeValidForFlow,
  isMasterPlusCurrentTier,
  isDuoBlockedAtTier,
  isStandardTier,
  hasDuplicateAddonCodes,
  getPdlBracket,
  resolveAddonLabel,
  NO_DIVISION_TIERS,
} from '../../../shared/boostDomain.ts'
import { isAddonCodeValidForClash } from '../../../shared/clashDomain.ts'
import { errorResponse, jsonResponse } from './responses.ts'
import type { supabaseAdmin } from './supabaseAdmin.ts'
import {
  estimateLpAverages,
  fetchLeagueEntries,
  fetchRecentRankedRecord,
  fetchRankedMatchIdsThisSplit,
  fetchRiotAccount,
  RIOT_DIVISION_MAP,
  RIOT_QUEUE_TYPE,
  RIOT_TIER_MAP,
} from './riotLookup.ts'

// ── Schemas ──────────────────────────────────────────────────────────────────
// O contrato é diferente por fluxo (padrão vs. Master+) — cada um usa
// `.strict()`, então um campo que não pertence ao fluxo (ex.: PDL alvo no
// Master+, ou Duo Boost no Master+) é rejeitado na validação, não apenas
// ignorado. A rota certa é decidida por um parse "leve" (routingSchema)
// antes de aplicar o schema estrito correspondente.
//
// Este módulo é compartilhado por create-pix-payment (cria o pedido e cobra
// via Mercado Pago) e order-quote (só cotação, read-only) — por isso ele não
// sabe nada sobre inserção em `orders` nem sobre Mercado Pago.

const STANDARD_TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond'] as const
const DIVISIONS = ['IV', 'III', 'II', 'I'] as const

const standardRankSchema = z.object({
  tier: z.enum(STANDARD_TIERS),
  division: z.enum(DIVISIONS),
}).strict()

// Rank alvo do fluxo padrão pode ir além de Diamond — até Master, Grão-Mestre
// ou Challenger — usando a mesma progressão por degrau (mesma fórmula de
// preço, sem tabela de PDL: isso é diferente do fluxo Master+, que só existe
// quando o rank ATUAL já é Master/Grão-Mestre). Tiers sem divisão devem vir
// com division nula.
const ALL_TIERS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'] as const
const standardTargetRankSchema = z.object({
  tier: z.enum(ALL_TIERS),
  division: z.enum(DIVISIONS).nullable().optional(),
}).strict().superRefine((val, ctx) => {
  if (NO_DIVISION_TIERS.includes(val.tier) && val.division) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Master, Grão-Mestre e Challenger não têm divisão', path: ['division'] })
  } else if (!NO_DIVISION_TIERS.includes(val.tier) && !val.division) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Divisão é obrigatória para este rank', path: ['division'] })
  }
})

const masterPlusCurrentRankSchema = z.object({
  tier: z.enum(['master', 'grandmaster']),
  division: z.null().optional(),
}).strict()

const masterPlusTargetRankSchema = z.object({
  tier: z.enum(['grandmaster', 'challenger']),
  division: z.null().optional(),
}).strict()

const genericRankSchema = z.object({
  tier: z.enum(['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger']),
  division: z.enum(DIVISIONS).nullable().optional(),
}).strict().superRefine((val, ctx) => {
  if (NO_DIVISION_TIERS.includes(val.tier) && val.division) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Master, Grão-Mestre e Challenger não têm divisão', path: ['division'] })
  } else if (!NO_DIVISION_TIERS.includes(val.tier) && !val.division) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Divisão é obrigatória para este rank', path: ['division'] })
  }
})

// Parse leve, só para decidir qual schema estrito aplicar em seguida. Não é
// usado para nada além de roteamento.
const routingSchema = z.object({
  service_type: z.enum(['elo_boost', 'win_boost', 'placement_matches', 'coaching', 'md5', 'clash']),
  current_rank: genericRankSchema.nullable().optional(),
  boost_mode: z.enum(['solo', 'duo']).optional(),
  queue_type: z.enum(['solo_duo', 'flex']).optional(),
}).passthrough()

// Riot ID: gameName#tagLine. gameName é 3-16 chars (regras da Riot),
// tagLine é 2-5 alfanuméricos.
const riotIdSchema = z.string().regex(/^.{3,16}#[^#]{2,5}$/, 'Riot ID inválido (formato: nome#tag)')

// Rotas escolhidas pelo cliente no configurador -- mesma regra de
// booster_services.lanes (migration 160): no máximo 2, subconjunto fixo das
// 5 lanes. Semântica (pro booster jogar vs. o próprio cliente jogar)
// depende de boost_mode, resolvida só no frontend/exibição -- aqui é só
// validação de forma.
const customerLanesSchema = z.array(z.enum(['top', 'jungle', 'mid', 'bot', 'support'])).max(2)
  // Sem isso, ['top','top'] passava (<=2 elementos, subconjunto válido) mas
  // getAvailableLanes só remove 'top' uma vez -- reservaria só 1 lane de
  // fato mesmo o cliente "gastando" as 2 vagas, liberando 4 pro booster em
  // vez de 3. A UI nunca manda duplicata (LaneSelectField.toggle já
  // previne), isso é defesa contra uma chamada direta à API.
  .refine((lanes) => new Set(lanes).size === lanes.length, 'Rotas duplicadas não são permitidas')
  .default([])

// Cupom de desconto — só o CÓDIGO vem do cliente, nunca um percentual/valor.
// O percentual é sempre resolvido server-side contra a whitelist fixa em
// applyCoupon() (shared/pricing.ts); um código inválido/inelegível aqui
// simplesmente não gera desconto, não é um erro de validação.
const couponCodeSchema = z.string().trim().max(32).nullable().default(null)

// Solo Boost / Duo Boost padrão — Iron a Diamond.
const standardEloIntentSchema = z.object({
  service_type: z.literal('elo_boost'),
  service_id: z.string().uuid(),
  game_id: z.string().uuid(),
  queue_type: z.enum(['solo_duo', 'flex']),
  boost_mode: z.enum(['solo', 'duo']),
  server: z.string().trim().min(2).max(16),
  current_rank: standardRankSchema,
  target_rank: standardTargetRankSchema,
  current_lp: z.number().int().min(0).max(100).default(0),
  // Compatibilidade com clientes antigos: aceitos, mas nunca usados.
  avg_lp_gain: z.number().int().min(1).max(50).optional(),
  avg_lp_loss: z.number().int().min(1).max(50).optional(),
  addon_codes: z.array(z.string().min(1)).max(10).default([]),
  win_package: z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().default(null),
  customer_notes: z.string().max(500).nullable().default(null),
  riot_id: riotIdSchema,
  coupon_code: couponCodeSchema,
  customer_lanes: customerLanesSchema,
}).strict()

// Boost Master+ — rank atual Master ou Grão-Mestre. Sem PDL alvo: o preço
// vem da tabela comercial (origem × destino × faixa de PDL atual, e agora
// também modalidade). Duo só é aceito na fila Flex (roteamento de fluxo,
// antes deste schema rodar, rejeita duo + Solo/Duo). Sem pacote de vitórias
// (o modelo de preço por vitória não se aplica ao Master+).
const masterPlusIntentSchema = z.object({
  service_type: z.literal('elo_boost'),
  service_id: z.string().uuid(),
  game_id: z.string().uuid(),
  queue_type: z.enum(['solo_duo', 'flex']),
  boost_mode: z.enum(['solo', 'duo']),
  server: z.string().trim().min(2).max(16),
  current_rank: masterPlusCurrentRankSchema,
  target_rank: masterPlusTargetRankSchema,
  current_pdl: z.number().int().min(0).default(0),
  avg_pdl_gain: z.number().positive().optional(),
  avg_pdl_loss: z.number().positive().optional(),
  addon_codes: z.array(z.string().min(1)).max(10).default([]),
  customer_notes: z.string().max(500).nullable().default(null),
  riot_id: riotIdSchema,
  coupon_code: couponCodeSchema,
  customer_lanes: customerLanesSchema,
}).strict()

// Win Boost / Placement Matches / Coaching — fora do escopo desta reforma
// (Solo/Duo/Master+); mantido como antes, só sem o campo target_lp morto.
const otherServiceIntentSchema = z.object({
  service_type: z.enum(['win_boost', 'placement_matches', 'coaching']),
  service_id: z.string().uuid(),
  game_id: z.string().uuid(),
  queue_type: z.enum(['solo_duo', 'flex']),
  boost_mode: z.enum(['solo', 'duo']),
  server: z.string().trim().min(2).max(16),
  current_rank: genericRankSchema.nullable(),
  target_rank: genericRankSchema.nullable(),
  current_lp: z.number().int().min(0).max(9999).default(0),
  avg_lp_gain: z.number().int().min(1).max(50).optional(),
  avg_lp_loss: z.number().int().min(1).max(50).optional(),
  // Vitórias — só win_boost usa este campo (1-5, mesmo cap do MD5, ver seção
  // 14-bis); placement_matches/coaching sempre mandam null aqui (reforçado
  // pelas checagens de negócio abaixo), então apertar o max não os afeta.
  wins_purchased: z.number().int().min(1).max(5).nullable(),
  sessions_purchased: z.number().int().min(1).max(20).nullable(),
  addon_codes: z.array(z.string().min(1)).max(10).default([]),
  win_package: z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().default(null),
  customer_notes: z.string().max(500).nullable().default(null),
  // Obrigatório quando service_type === 'coaching' (validado abaixo, não no
  // schema — o mesmo schema também cobre win_boost/placement_matches, que
  // não usam pacote de coach nenhum).
  booster_service_id: z.string().uuid().nullable().default(null),
  // Riot ID — só win_boost usa (o booster precisa da conta pra logar e
  // cumprir o pedido); placement_matches/coaching sempre mandam null aqui
  // (reforçado pelas checagens de negócio abaixo).
  riot_id: riotIdSchema.nullable().default(null),
  coupon_code: couponCodeSchema,
  customer_lanes: customerLanesSchema,
}).strict()

// MD5 — "Rank da última temporada": Iron–Challenger valid, no LP/PDL/target
// concept (win-rate-guarantee is priced per net win, not per rank progression).
const md5IntentSchema = z.object({
  service_type: z.literal('md5'),
  service_id: z.string().uuid(),
  game_id: z.string().uuid(),
  queue_type: z.enum(['solo_duo', 'flex']),
  boost_mode: z.enum(['solo', 'duo']),
  server: z.string().trim().min(2).max(16),
  // "Rank da última temporada" — no LP/PDL, no target. Iron–Challenger valid;
  // division required except Master+.
  current_rank: genericRankSchema,
  wins_purchased: z.number().int().min(1).max(5),
  addon_codes: z.array(z.string().min(1)).max(10).default([]),
  customer_notes: z.string().max(500).nullable().default(null),
  riot_id: riotIdSchema,
  coupon_code: couponCodeSchema,
  customer_lanes: customerLanesSchema,
}).strict()

// Solo Clash / Duo Clash — preço e elegibilidade dependem só do tier (faixa),
// não de rank+divisão exato, então current_rank/current_lp aqui são
// informativos (exibição no card de detalhes), nunca usados pra precificar
// ou validar o tier. Ambos opcionais: pedidos antigos e qualquer client que
// não os envie continuam válidos, current_rank cai em null. Dia é
// obrigatório e restrito a sábado ou domingo -- qualquer outro valor é
// rejeitado pelo próprio z.enum. Riot ID é obrigatório nos dois modos: no
// Solo, é referência do booster antes de logar via credenciais; no Duo, é o
// identificador que o booster usa pra convidar o cliente pro time dentro do
// jogo (não há handoff de credenciais no Duo).
const clashIntentSchema = z.object({
  service_type: z.literal('clash'),
  service_id: z.string().uuid(),
  game_id: z.string().uuid(),
  boost_mode: z.enum(['solo', 'duo']),
  server: z.string().trim().min(2).max(16),
  clash_tier: z.enum(['tier_4', 'tier_3', 'tier_2', 'tier_1']),
  clash_day: z.enum(['saturday', 'sunday']),
  current_rank: genericRankSchema.nullable().optional().default(null),
  current_lp: z.number().int().min(0).max(9999).optional().default(0),
  addon_codes: z.array(z.string().min(1)).max(10).default([]),
  customer_notes: z.string().max(500).nullable().default(null),
  riot_id: riotIdSchema,
  coupon_code: couponCodeSchema,
  customer_lanes: customerLanesSchema,
}).strict()

// Forma normalizada usada pelo resto do handler, independente de qual dos 3
// schemas estritos validou o intent — evita espalhar `'campo' in intent`
// pelo código abaixo.
export interface NormalizedIntent {
  serviceType: ServiceType
  serviceId: string
  gameId: string
  queueType: 'solo_duo' | 'flex'
  boostMode: 'solo' | 'duo'
  server: string
  currentRank: RankValue | null
  targetRank: RankValue | null
  currentLp: number
  avgLpGain: number
  avgLpLoss: number
  winsPurchased: number | null
  sessionsPurchased: number | null
  addonCodes: string[]
  winPackage: 1 | 3 | 5 | null
  customerNotes: string | null
  currentPdl: number | null
  avgPdlGain: number | null
  avgPdlLoss: number | null
  riotId: string | null
  boosterServiceId: string | null
  couponCode: string | null
  // Clash — null para qualquer outro serviceType.
  clashTier: ClashTier | null
  clashDay: ClashDay | null
  customerLanes: string[]
}

export interface QuoteResult {
  ok: true
  normalized: NormalizedIntent
  priced: ReturnType<typeof computeOrderPrice>
  md5MatchesRemaining: number | null
  pdlBracket: string | null
  coachPackagePrice: number | null
  preferredBoosterId: string | null
  extras: { id: string; code: string | null; name: string; price_modifier: number; price_modifier_pct: number; sort_order: number }[]
}

export type QuoteOutcome = QuoteResult | { ok: false; response: Response }

function badRequest(req: Request, message: string): Response {
  return errorResponse(req, message, 400)
}

// Preço do Master+ pra (origem, destino, fila), no maior degrau de PDL
// (master_plus_pricing.pdl_from) que não ultrapasse o PDL atual -- PDL acima
// do último degrau cadastrado cai no preço do último (mais barato), nunca
// fica sem preço por estourar a tabela. Usado tanto pelo fluxo Master+ (PDL
// real do cliente) quanto pelo fluxo padrão mirando Grão-Mestre/Challenger a
// partir de Diamond- (sempre PDL=0 -- entra em Mestre do zero).
async function fetchMasterPlusPrice(
  serviceClient: ReturnType<typeof supabaseAdmin>,
  currentTier: 'master' | 'grandmaster',
  targetTier: 'grandmaster' | 'challenger',
  queueType: 'solo_duo' | 'flex',
  currentPdl: number,
  boostMode: 'solo' | 'duo',
): Promise<number | null> {
  const { data, error } = await serviceClient
    .from('master_plus_pricing')
    .select('price')
    .eq('current_tier', currentTier)
    .eq('target_tier', targetTier)
    .eq('queue_type', queueType)
    .eq('boost_mode', boostMode)
    .lte('pdl_from', Math.max(0, currentPdl))
    .order('pdl_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.price != null ? Number(data.price) : null
}

// Valida (schema por fluxo + regras de negócio), reconfere elegibilidade MD5
// direto na Riot, valida pacote de coach/addons e calcula o preço
// autoritativo — tudo que create-pix-payment e order-quote têm em comum.
// Nunca cria pedido, nunca chama Mercado Pago, nunca confia em preço vindo
// do cliente.
export async function validateAndPriceIntent(
  req: Request,
  intent: unknown,
  userId: string,
  serviceClient: ReturnType<typeof supabaseAdmin>,
  riotApiKey: string,
  preferredBoosterIdInput: string | null,
): Promise<QuoteOutcome> {
  // Booster diretamente vinculado (veio do perfil público) — nunca confia
  // no client além do id; precisa ser um booster aprovado e não pode ser
  // o próprio cliente.
  let preferredBoosterId: string | null = null
  if (preferredBoosterIdInput) {
    if (preferredBoosterIdInput === userId) {
      return { ok: false, response: badRequest(req, 'Você não pode vincular um pedido a si mesmo') }
    }
    const { data: boosterRow, error: boosterErr } = await serviceClient
      .from('booster_profiles')
      .select('user_id')
      .eq('user_id', preferredBoosterIdInput)
      .eq('status', 'approved')
      .maybeSingle()
    if (boosterErr) return { ok: false, response: errorResponse(req, 'Failed to validate booster', 500) }
    if (!boosterRow) return { ok: false, response: badRequest(req, 'Booster inválido ou não aprovado') }
    preferredBoosterId = boosterRow.user_id
  }

  const routed = routingSchema.safeParse(intent)
  if (!routed.success) {
    return {
      ok: false,
      response: jsonResponse(req, {
        error: 'Body inválido',
        issues: routed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }, 400),
    }
  }

  let flow: BoostFlow | null = null

  if (routed.data.service_type === 'elo_boost') {
    const tier = routed.data.current_rank?.tier
    if (!tier) return { ok: false, response: badRequest(req, 'current_rank é obrigatório para elo_boost') }
    if (tier === 'challenger') return { ok: false, response: badRequest(req, 'Challenger não pode ser selecionado como rank atual') }

    if (isMasterPlusCurrentTier(tier)) {
      // Duo Boost no Master+ só é aceito na fila Flex -- a Riot não
      // restringe duo por elo lá; Solo/Duo continua Iron-Diamond only.
      if (routed.data.boost_mode === 'duo' && routed.data.queue_type !== 'flex') {
        return { ok: false, response: badRequest(req, 'Duo Boost no Master+ só é aceito na fila Flex — na Solo/Duo é só até Diamante') }
      }
      flow = 'master_plus'
    } else if (isStandardTier(tier)) {
      flow = routed.data.boost_mode === 'duo' ? 'duo_standard' : 'solo_standard'
    } else {
      return { ok: false, response: badRequest(req, 'Rank atual inválido') }
    }
  }

  const schema = flow === 'master_plus'
    ? masterPlusIntentSchema
    : flow
      ? standardEloIntentSchema
      : routed.data.service_type === 'md5'
        ? md5IntentSchema
        : routed.data.service_type === 'clash'
          ? clashIntentSchema
          : otherServiceIntentSchema

  const parsedIntent = schema.safeParse(intent)
  if (!parsedIntent.success) {
    return {
      ok: false,
      response: jsonResponse(req, {
        error: 'Body inválido',
        issues: parsedIntent.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }, 400),
    }
  }

  let normalized: NormalizedIntent
  let pdlBracket: string | null = null
  let masterPlusPrice: number | null = null
  let masterPlusCutoffs: MasterPlusCutoffs | undefined

  if (flow === 'master_plus') {
    const mp = parsedIntent.data as z.infer<typeof masterPlusIntentSchema>
    // Mesma regra de bloqueio de rank do fluxo padrão (rankStep) — Master+ não
    // precisa de uma lista de progressões separada, o degrau alvo só precisa
    // ser maior que o degrau atual (Master=28, Grão-Mestre=29, Challenger=30).
    if (rankStep(mp.target_rank.tier, null) <= rankStep(mp.current_rank.tier, null)) {
      return { ok: false, response: badRequest(req, 'Rank de destino precisa ser maior que o rank atual') }
    }
    // pdlBracket é só informativo (gravado em orders.pdl_bracket) — não entra
    // mais na chave de preço, que agora é um valor fixo por tier alvo.
    pdlBracket = getPdlBracket(mp.current_pdl)

    let masterPlusPriceValue: number | null
    try {
      masterPlusPriceValue = await fetchMasterPlusPrice(
        serviceClient, mp.current_rank.tier, mp.target_rank.tier, mp.queue_type, mp.current_pdl, mp.boost_mode,
      )
    } catch {
      return { ok: false, response: errorResponse(req, 'Falha ao carregar preço', 500) }
    }
    if (masterPlusPriceValue == null) {
      return { ok: false, response: badRequest(req, 'Preço ainda não configurado para essa combinação de tiers. Fale com o suporte.') }
    }
    masterPlusPrice = masterPlusPriceValue

    // Corte atual de GM/Challenger, se já cacheado (riot-league-cutoffs) --
    // afeta tanto a estimativa de horas quanto o desconto do trecho
    // Mestre->alvo (applyMasterPlusPdlDiscount, via masterPlusTargetLp).
    // Sem cache ainda: computeOrderPrice cai pros alvos fixos default.
    const { data: cutoffRows } = await serviceClient
      .from('riot_league_cutoffs')
      .select('tier, cutoff_lp')
      .eq('queue', mp.queue_type)
    if (cutoffRows?.length) {
      masterPlusCutoffs = {
        grandmaster: cutoffRows.find((r) => r.tier === 'grandmaster')?.cutoff_lp ?? null,
        challenger: cutoffRows.find((r) => r.tier === 'challenger')?.cutoff_lp ?? null,
      }
    }

    normalized = {
      serviceType: 'elo_boost',
      serviceId: mp.service_id,
      gameId: mp.game_id,
      queueType: mp.queue_type,
      boostMode: mp.boost_mode,
      server: mp.server,
      currentRank: { tier: mp.current_rank.tier, division: null },
      targetRank: { tier: mp.target_rank.tier, division: null },
      currentLp: 0,
      avgLpGain: 20,
      avgLpLoss: 15,
      winsPurchased: null,
      sessionsPurchased: null,
      addonCodes: mp.addon_codes,
      winPackage: null,
      customerNotes: mp.customer_notes,
      currentPdl: mp.current_pdl,
      // Regra comercial da estimativa Master+: progressão fixa de 30 PDL
      // por partida. Valores enviados pelo cliente não viram autoridade.
      avgPdlGain: 30,
      avgPdlLoss: 30,
      riotId: mp.riot_id,
      boosterServiceId: null,
      couponCode: mp.coupon_code,
      clashTier: null,
      clashDay: null,
      customerLanes: mp.customer_lanes,
    }
  } else if (flow) {
    const std = parsedIntent.data as z.infer<typeof standardEloIntentSchema>
    if (rankStep(std.target_rank.tier, std.target_rank.division ?? null) <= rankStep(std.current_rank.tier, std.current_rank.division ?? null)) {
      return { ok: false, response: badRequest(req, 'Rank de destino precisa ser maior que o rank atual') }
    }
    // Duo Boost com alvo Master+ (Master/Grão-Mestre/Challenger) só é aceito
    // na fila Flex -- na Solo/Duo segue disponível só até Diamante.
    if (
      std.boost_mode === 'duo' && std.queue_type !== 'flex'
      && (std.target_rank.tier === 'master' || std.target_rank.tier === 'grandmaster' || std.target_rank.tier === 'challenger')
    ) {
      return { ok: false, response: badRequest(req, 'Duo Boost não é aceito para rank alvo Master+ na fila Solo/Duo — escolha Flex ou mire até Diamante') }
    }
    normalized = {
      serviceType: 'elo_boost',
      serviceId: std.service_id,
      gameId: std.game_id,
      queueType: std.queue_type,
      boostMode: std.boost_mode,
      server: std.server,
      currentRank: { tier: std.current_rank.tier, division: std.current_rank.division ?? null },
      targetRank: { tier: std.target_rank.tier, division: std.target_rank.division ?? null },
      currentLp: std.current_lp,
      avgLpGain: 22,
      avgLpLoss: 22,
      winsPurchased: null,
      sessionsPurchased: null,
      addonCodes: std.addon_codes,
      winPackage: std.win_package,
      customerNotes: std.customer_notes,
      currentPdl: null,
      avgPdlGain: null,
      avgPdlLoss: null,
      riotId: std.riot_id,
      boosterServiceId: null,
      couponCode: std.coupon_code,
      clashTier: null,
      clashDay: null,
      customerLanes: std.customer_lanes,
    }

    // Diamond- mirando Grão-Mestre/Challenger direto: o trecho Mestre->alvo
    // usa o mesmo preço por PDL do fluxo Master+, sempre a partir do PDL=0
    // (quem vem do fluxo padrão entra em Mestre do zero). "master" como alvo
    // exato não entra aqui -- já fica totalmente coberto pelo preço por
    // divisão (calcEloPrice) em computeOrderPrice.
    if (std.target_rank.tier === 'grandmaster' || std.target_rank.tier === 'challenger') {
      let priceValue: number | null
      try {
        priceValue = await fetchMasterPlusPrice(serviceClient, 'master', std.target_rank.tier, std.queue_type, 0, std.boost_mode)
      } catch {
        return { ok: false, response: errorResponse(req, 'Falha ao carregar preço', 500) }
      }
      if (priceValue == null) {
        return { ok: false, response: badRequest(req, 'Preço ainda não configurado para essa combinação de tiers. Fale com o suporte.') }
      }
      masterPlusPrice = priceValue

      // Mesmo corte ao vivo (riot-league-cutoffs) usado pelo fluxo Master+ --
      // afeta a estimativa de horas E o desconto do trecho Mestre->alvo
      // (applyMasterPlusPdlDiscount). Sem cache ainda: cai pros alvos fixos
      // default (MASTER_PLUS_TARGET_LP).
      const { data: cutoffRows } = await serviceClient
        .from('riot_league_cutoffs')
        .select('tier, cutoff_lp')
        .eq('queue', std.queue_type)
      if (cutoffRows?.length) {
        masterPlusCutoffs = {
          grandmaster: cutoffRows.find((r) => r.tier === 'grandmaster')?.cutoff_lp ?? null,
          challenger: cutoffRows.find((r) => r.tier === 'challenger')?.cutoff_lp ?? null,
        }
      }
    }
  } else if (routed.data.service_type === 'md5') {
    const md5 = parsedIntent.data as z.infer<typeof md5IntentSchema>
    // MD5 nunca bloqueia Duo por rank, mesmo em Grão-Mestre/Challenger --
    // diferente de Elo Boost/Vitórias, o rank aqui é "da última temporada"
    // (informado pelo cliente, nunca reverificado ao vivo) e a partida real
    // de MD5 acontece bem abaixo desse elo, então Duo sempre é viável.
    normalized = {
      serviceType: 'md5',
      serviceId: md5.service_id,
      gameId: md5.game_id,
      queueType: md5.queue_type,
      boostMode: md5.boost_mode,
      server: md5.server,
      currentRank: { tier: md5.current_rank.tier, division: md5.current_rank.division ?? null },
      targetRank: null,
      currentLp: 0,
      avgLpGain: 20,
      avgLpLoss: 15,
      winsPurchased: md5.wins_purchased,
      sessionsPurchased: null,
      addonCodes: md5.addon_codes,
      winPackage: null,
      customerNotes: md5.customer_notes,
      currentPdl: null,
      avgPdlGain: null,
      avgPdlLoss: null,
      riotId: md5.riot_id,
      boosterServiceId: null,
      couponCode: md5.coupon_code,
      clashTier: null,
      clashDay: null,
      customerLanes: md5.customer_lanes,
    }
  } else if (routed.data.service_type === 'clash') {
    const clash = parsedIntent.data as z.infer<typeof clashIntentSchema>
    normalized = {
      serviceType: 'clash',
      serviceId: clash.service_id,
      gameId: clash.game_id,
      // Clash não usa fila ranqueada -- 'solo_duo' é só o valor default de
      // orders.queue_type (coluna NOT NULL com default), nunca lido de
      // volta pra nada específico de Clash.
      queueType: 'solo_duo',
      boostMode: clash.boost_mode,
      server: clash.server,
      currentRank: clash.current_rank ? { tier: clash.current_rank.tier, division: clash.current_rank.division ?? null } : null,
      targetRank: null,
      currentLp: clash.current_lp ?? 0,
      avgLpGain: 20,
      avgLpLoss: 15,
      winsPurchased: null,
      sessionsPurchased: null,
      addonCodes: clash.addon_codes,
      winPackage: null,
      customerNotes: clash.customer_notes,
      currentPdl: null,
      avgPdlGain: null,
      avgPdlLoss: null,
      riotId: clash.riot_id,
      boosterServiceId: null,
      couponCode: clash.coupon_code,
      clashTier: clash.clash_tier,
      clashDay: clash.clash_day,
      customerLanes: clash.customer_lanes,
    }
  } else {
    const other = parsedIntent.data as z.infer<typeof otherServiceIntentSchema>
    if (other.service_type === 'win_boost') {
      if (!other.current_rank) return { ok: false, response: badRequest(req, 'Rank atual é obrigatório para Vitórias') }
      if (!other.wins_purchased) return { ok: false, response: badRequest(req, 'Quantidade de vitórias é obrigatória') }
      if (other.win_package) return { ok: false, response: badRequest(req, 'Pacote de vitórias extras não é aceito em Vitórias') }
      if (other.booster_service_id) return { ok: false, response: badRequest(req, 'Pacote de coach não é aceito em Vitórias') }
      if (!other.riot_id) return { ok: false, response: badRequest(req, 'Riot ID é obrigatório para Vitórias') }
    }
    if (other.service_type === 'placement_matches') {
      if (!other.current_rank) return { ok: false, response: badRequest(req, 'Rank final da última temporada é obrigatório para MD5 Completo') }
      if (other.wins_purchased || other.win_package) return { ok: false, response: badRequest(req, 'Vitórias não são aceitas em MD5 Completo') }
      if (other.booster_service_id) return { ok: false, response: badRequest(req, 'Pacote de coach não é aceito em MD5 Completo') }
      if (other.riot_id) return { ok: false, response: badRequest(req, 'Riot ID não é aceito em MD5 Completo') }
      if (other.customer_lanes.length) return { ok: false, response: badRequest(req, 'Rotas não são aceitas em MD5 Completo') }
    }
    if (other.service_type === 'coaching') {
      if (!other.booster_service_id) return { ok: false, response: badRequest(req, 'Selecione um pacote de coach') }
      if (other.current_rank || other.target_rank || other.wins_purchased || other.win_package) {
        return { ok: false, response: badRequest(req, 'Ranks e vitórias não são aceitos em Coaching') }
      }
      if (other.riot_id) return { ok: false, response: badRequest(req, 'Riot ID não é aceito em Coaching') }
      if (other.customer_lanes.length) return { ok: false, response: badRequest(req, 'Rotas não são aceitas em Coaching') }
    }
    normalized = {
      serviceType: other.service_type,
      serviceId: other.service_id,
      gameId: other.game_id,
      queueType: other.queue_type,
      boostMode: other.boost_mode,
      server: other.server,
      currentRank: other.current_rank as RankValue,
      targetRank: other.target_rank as RankValue | null,
      currentLp: other.current_lp,
      avgLpGain: 22,
      avgLpLoss: 22,
      winsPurchased: other.wins_purchased,
      sessionsPurchased: other.sessions_purchased,
      addonCodes: other.addon_codes,
      winPackage: other.win_package,
      customerNotes: other.customer_notes,
      currentPdl: null,
      avgPdlGain: null,
      avgPdlLoss: null,
      riotId: other.riot_id,
      boosterServiceId: other.booster_service_id,
      couponCode: other.coupon_code,
      clashTier: null,
      clashDay: null,
      customerLanes: other.customer_lanes,
    }
  }

  // A consulta do navegador é somente uma prévia. No fechamento, Elo Boost
  // e Vitórias são consultados novamente e os dados sensíveis são
  // substituídos pelos valores derivados server-side.
  if (normalized.serviceType === 'elo_boost' || normalized.serviceType === 'win_boost') {
    if (!riotApiKey || !normalized.riotId) {
      return { ok: false, response: errorResponse(req, 'Server misconfigured', 500) }
    }

    const accountResult = await fetchRiotAccount(normalized.riotId, riotApiKey, 'americas')
    if (!accountResult.ok) {
      if (accountResult.reason === 'not_found') return { ok: false, response: badRequest(req, 'Conta Riot não encontrada') }
      if (accountResult.reason === 'rate_limited') {
        return { ok: false, response: errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503) }
      }
      console.error('Riot account lookup failed', accountResult.status)
      return { ok: false, response: errorResponse(req, 'Falha ao consultar conta Riot', 502) }
    }

    const leagueResult = await fetchLeagueEntries(accountResult.account.puuid, riotApiKey, 'br1')
    if (!leagueResult.ok) {
      if (leagueResult.reason === 'rate_limited') {
        return { ok: false, response: errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503) }
      }
      console.error('Riot league lookup failed', leagueResult.status)
      return { ok: false, response: errorResponse(req, 'Falha ao consultar elo na Riot', 502) }
    }

    const { leagueQueue } = RIOT_QUEUE_TYPE[normalized.queueType]
    const entry = leagueResult.entries.find((candidate) => candidate.queueType === leagueQueue)
    const verifiedTier = entry?.tier ? RIOT_TIER_MAP[entry.tier] ?? null : null
    if (!entry || !verifiedTier) {
      return { ok: false, response: badRequest(req, 'A conta não possui rank na fila selecionada') }
    }

    const verifiedDivision = NO_DIVISION_TIERS.includes(verifiedTier)
      ? null
      : entry.rank ? RIOT_DIVISION_MAP[entry.rank] ?? null : null
    if (!NO_DIVISION_TIERS.includes(verifiedTier) && !verifiedDivision) {
      return { ok: false, response: errorResponse(req, 'A Riot retornou uma divisão inválida', 502) }
    }

    const verifiedMasterPlus = isMasterPlusCurrentTier(verifiedTier)
    if (normalized.serviceType === 'elo_boost' && verifiedMasterPlus !== (flow === 'master_plus')) {
      return { ok: false, response: badRequest(req, 'Seu elo mudou desde a consulta. Verifique a conta novamente antes de pagar.') }
    }
    // Duo tem regras diferentes por serviço, mas ambas liberam na fila Flex
    // agora (a Riot não restringe duo por elo lá): Elo Boost Duo é
    // Iron-Diamond only na Solo/Duo (bloqueado assim que o rank confirmado
    // pela Riot já é Master+); Vitórias/MD5 aceitam Duo até Master na
    // Solo/Duo, bloqueado só a partir de Grão-Mestre (isDuoBlockedAtTier).
    // Pega tanto um elo que mudou de tier entre a cotação e o pagamento
    // quanto um current_rank adulterado que passou pela checagem inicial.
    if (
      normalized.serviceType === 'elo_boost' && normalized.boostMode === 'duo'
      && normalized.queueType !== 'flex' && isMasterPlusCurrentTier(verifiedTier)
    ) {
      return { ok: false, response: badRequest(req, 'Duo Boost no Master+ só é aceito na fila Flex — na Solo/Duo é só até Diamante') }
    }
    if (
      normalized.serviceType === 'win_boost' && normalized.boostMode === 'duo'
      && normalized.queueType !== 'flex' && isDuoBlockedAtTier(verifiedTier)
    ) {
      return { ok: false, response: badRequest(req, 'Duo não é aceito a partir de Grão-Mestre na fila Solo/Duo — escolha Flex') }
    }

    normalized.currentRank = { tier: verifiedTier, division: verifiedDivision }
    const leaguePoints = Math.max(0, Number(entry.leaguePoints ?? 0))
    const recentRecord = await fetchRecentRankedRecord(
      accountResult.account.puuid, riotApiKey, 'americas', normalized.queueType,
    )
    if (!recentRecord.ok) {
      if (recentRecord.reason === 'rate_limited') {
        return { ok: false, response: errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503) }
      }
      console.error('Riot recent matches lookup failed', recentRecord.status)
      return { ok: false, response: errorResponse(req, 'Falha ao consultar as últimas partidas na Riot', 502) }
    }
    const averages = estimateLpAverages(verifiedTier, recentRecord.wins, recentRecord.losses)
    normalized.currentLp = verifiedMasterPlus ? 0 : Math.min(100, leaguePoints)
    normalized.currentPdl = verifiedMasterPlus ? leaguePoints : null
    normalized.avgLpGain = verifiedMasterPlus ? 30 : averages.gain
    normalized.avgLpLoss = verifiedMasterPlus ? 30 : averages.loss
    // Master+ nunca usa a média real de PDL/vitória vinda da Riot -- a
    // progressão comercial é sempre fixa em 30 PDL/partida (mesmo valor de
    // MASTER_PLUS_LP_PER_GAME). A média da API só entra para Diamond-.
    normalized.avgPdlGain = verifiedMasterPlus ? 30 : null
    normalized.avgPdlLoss = verifiedMasterPlus ? 30 : null

    if (normalized.serviceType === 'elo_boost') {
      if (!normalized.targetRank
          || rankStep(normalized.targetRank.tier, normalized.targetRank.division) <= rankStep(verifiedTier, verifiedDivision)) {
        return { ok: false, response: badRequest(req, 'Rank de destino precisa ser maior que o rank atual verificado na Riot') }
      }
      if (verifiedMasterPlus) {
        pdlBracket = getPdlBracket(leaguePoints)

        // masterPlusPrice foi calculado antes da verificação Riot, com o
        // current_pdl que o CLIENTE enviou (não autoritativo -- só usado
        // pra pré-visualização no navegador). Sem recalcular aqui, um
        // current_pdl inflado escolhia uma faixa de preço mais barata (a
        // tabela é decrescente conforme o PDL sobe) e isso ia direto pro
        // total_price cobrado, sem nenhuma outra validação pegar.
        if (flow === 'master_plus' && normalized.targetRank) {
          let verifiedMasterPlusPrice: number | null
          try {
            verifiedMasterPlusPrice = await fetchMasterPlusPrice(
              serviceClient, verifiedTier, normalized.targetRank.tier as 'grandmaster' | 'challenger', normalized.queueType, leaguePoints, normalized.boostMode,
            )
          } catch {
            return { ok: false, response: errorResponse(req, 'Falha ao carregar preço', 500) }
          }
          if (verifiedMasterPlusPrice == null) {
            return { ok: false, response: badRequest(req, 'Preço ainda não configurado para essa combinação de tiers. Fale com o suporte.') }
          }
          masterPlusPrice = verifiedMasterPlusPrice
        }
      }
    }
  }

  const [{ data: service, error: serviceError }, { data: game, error: gameError }] = await Promise.all([
    serviceClient.from('services').select('id, game_id, type, is_active').eq('id', normalized.serviceId).maybeSingle(),
    serviceClient.from('games').select('id, is_active').eq('id', normalized.gameId).maybeSingle(),
  ])
  if (serviceError || gameError) return { ok: false, response: errorResponse(req, 'Failed to validate catalog', 500) }
  // `service`/`game` só são referenciados depois de confirmados não-nulos --
  // um service_id/game_id inexistente no catálogo (typo, id de outro jogo,
  // string arbitrária) sempre vem como maybeSingle() = null, nunca um erro,
  // então checar `.type` antes deste guard derrubava a função com uma
  // exceção não tratada (500 cru) em vez do 400 de validação de negócio.
  if (!service || !game || !service.is_active || !game.is_active || service.game_id !== game.id) {
    return { ok: false, response: badRequest(req, 'Serviço ou jogo inválido/inativo') }
  }
  const serviceTypeMatchesCatalog =
    service.type === normalized.serviceType
    || (normalized.serviceType === 'md5' && service.type === 'win_boost')

  if (!serviceTypeMatchesCatalog) {
    return { ok: false, response: badRequest(req, 'Serviço ou jogo inválido/inativo') }
  }

  // ── MD5: a pré-visualização do cliente (riot-account-rank) é só um
  // preview — nunca confiável para decidir elegibilidade. Aqui a Riot é
  // consultada de novo, server-side, e o pedido é bloqueado se a conta já
  // tiver rank na fila selecionada nesta temporada.
  let md5MatchesRemaining: number | null = null
  if (normalized.serviceType === 'md5') {
    if (!riotApiKey) return { ok: false, response: errorResponse(req, 'Server misconfigured', 500) }
    if (!normalized.winsPurchased || normalized.winsPurchased < 1 || normalized.winsPurchased > 5) {
      return { ok: false, response: badRequest(req, 'MD5 aceita apenas 1 a 5 vitórias') }
    }
    const accountResult = await fetchRiotAccount(normalized.riotId!, riotApiKey, 'americas')
    if (!accountResult.ok) {
      if (accountResult.reason === 'not_found') {
        return { ok: false, response: badRequest(req, 'Conta Riot não encontrada') }
      }
      if (accountResult.reason === 'rate_limited') {
        return { ok: false, response: errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503) }
      }
      console.error('Riot account lookup failed', accountResult.status)
      return { ok: false, response: errorResponse(req, 'Falha ao consultar conta Riot', 502) }
    }
    const leagueResult = await fetchLeagueEntries(accountResult.account.puuid, riotApiKey, 'br1')
    if (!leagueResult.ok) {
      if (leagueResult.reason === 'rate_limited') {
        return { ok: false, response: errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503) }
      }
      console.error('Riot league lookup failed', leagueResult.status)
      return { ok: false, response: errorResponse(req, 'Falha ao verificar elegibilidade MD5', 502) }
    }

    const { leagueQueue } = RIOT_QUEUE_TYPE[normalized.queueType]
    const alreadyRanked = leagueResult.entries.some((e) => e.queueType === leagueQueue && RIOT_TIER_MAP[e.tier ?? ''])
    if (alreadyRanked) {
      return { ok: false, response: badRequest(req, 'Esta conta já possui rank na fila selecionada nesta temporada — MD5 não está disponível.') }
    }

    md5MatchesRemaining = 5
    const splitStart = Number(Deno.env.get('LOL_SPLIT_START_TIMESTAMP') ?? '0')
    if (splitStart > 0) {
      const matchResult = await fetchRankedMatchIdsThisSplit(
        accountResult.account.puuid, riotApiKey, 'americas', normalized.queueType, splitStart,
      )
      if (matchResult.ok) md5MatchesRemaining = Math.max(0, 5 - matchResult.matchIds.length)
    }
    if (md5MatchesRemaining < 1) return { ok: false, response: badRequest(req, 'MD5 já foi concluída nesta fila') }
    if (normalized.winsPurchased > md5MatchesRemaining) {
      return { ok: false, response: badRequest(req, `MD5 possui no máximo ${md5MatchesRemaining} partida(s) restante(s) nesta fila`) }
    }
  }

  // ── Coaching agora exige um pacote real de um booster (booster_services,
  // service_type='coaching') — preço nunca vem do cliente, sempre lido do
  // pacote. O booster vinculado ao pedido também vem sempre do pacote,
  // nunca de preferredBoosterIdInput (evita pagar o pacote do booster A
  // mas vincular exclusividade ao booster B).
  let coachPackagePrice: number | null = null
  if (normalized.serviceType === 'coaching') {
    if (!normalized.boosterServiceId) return { ok: false, response: badRequest(req, 'Selecione um pacote de coach') }

    const { data: coachPackage, error: coachPackageErr } = await serviceClient
      .from('booster_services')
      .select('id, booster_id, price, is_active, service_type')
      .eq('id', normalized.boosterServiceId)
      .eq('service_type', 'coaching')
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (coachPackageErr) return { ok: false, response: errorResponse(req, 'Failed to validate coach package', 500) }
    if (!coachPackage) return { ok: false, response: badRequest(req, 'Pacote de coach inválido ou inativo') }

    const { data: coachBoosterRow, error: coachBoosterErr } = await serviceClient
      .from('booster_profiles')
      .select('user_id')
      .eq('user_id', coachPackage.booster_id)
      .eq('status', 'approved')
      .maybeSingle()
    if (coachBoosterErr) return { ok: false, response: errorResponse(req, 'Failed to validate booster', 500) }
    if (!coachBoosterRow) return { ok: false, response: badRequest(req, 'Booster do pacote não está aprovado') }

    coachPackagePrice = Number(coachPackage.price)
    preferredBoosterId = coachBoosterRow.user_id
  }

  // ── Addons: validados contra a whitelist do fluxo E contra o catálogo
  // vivo em service_extras (ativo, do fluxo certo). Nunca aceita
  // percentual/label vindo do cliente — só o código.
  const addonCodes = [...new Set(normalized.addonCodes)]
  let extras: { id: string; code: string | null; name: string; price_modifier: number; price_modifier_pct: number; sort_order: number }[] = []

  if (hasDuplicateAddonCodes(normalized.addonCodes)) return { ok: false, response: badRequest(req, 'Addon duplicado') }

  // Clash reaproveita a mesma LINHA/tabela do catálogo do Elo Boost: Solo
  // Clash lê de 'solo_standard' (mesmo de Solo Boost/Vitórias/MD5), Duo
  // Clash de 'duo_standard' (mesmo de Duo Boost) — mas só aceita o
  // subconjunto de códigos em CLASH_ADDON_CODES (whitelist própria do
  // Clash), não a whitelist inteira do fluxo.
  const addonFlow: BoostFlow | null = flow ?? (
    normalized.serviceType === 'win_boost' || normalized.serviceType === 'md5' || normalized.serviceType === 'clash'
      ? (normalized.boostMode === 'duo' ? 'duo_standard' : 'solo_standard')
      : null
  )

  if (addonFlow) {
    for (const code of addonCodes) {
      const valid = normalized.serviceType === 'clash'
        ? isAddonCodeValidForClash(normalized.boostMode, code)
        : isAddonCodeValidForFlow(addonFlow, code)
      if (!valid) return { ok: false, response: badRequest(req, `Addon inválido para este fluxo: ${code}`) }
    }
    if (addonCodes.length > 0) {
      const { data: rows, error: extraErr } = await serviceClient
        .from('service_extras')
        .select('id, code, name, description, price_modifier, price_modifier_pct, sort_order, service_type_overrides')
        .eq('flow', addonFlow)
        .eq('is_active', true)
        .in('code', addonCodes)
      if (extraErr) return { ok: false, response: errorResponse(req, 'Failed to load extras', 500) }
      if (!rows || rows.length !== addonCodes.length) return { ok: false, response: badRequest(req, 'Addon inexistente ou inativo') }
      // Mesmo texto que o cliente viu no configurador (resolveAddonLabel) fica
      // congelado no snapshot do pedido -- nunca o name genérico de Elo Boost
      // pra um addon comprado via Vitórias/MD5/Clash.
      extras = rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: resolveAddonLabel(row, normalized.serviceType).name,
        price_modifier: row.price_modifier,
        price_modifier_pct: row.price_modifier_pct,
        sort_order: row.sort_order,
      }))
    }
  } else if (addonCodes.length > 0) {
    return { ok: false, response: badRequest(req, 'Addons não são aceitos para este tipo de serviço') }
  }

  const priceInput: OrderPriceInput = {
    serviceType: normalized.serviceType,
    queueType: normalized.queueType,
    boostMode: normalized.boostMode,
    currentRank: normalized.currentRank,
    targetRank: normalized.targetRank,
    currentLp: normalized.currentLp,
    avgLpGain: normalized.avgLpGain,
    avgLpLoss: normalized.avgLpLoss,
    currentPdl: normalized.currentPdl,
    avgPdlGain: normalized.avgPdlGain,
    masterPlusPrice,
    masterPlusCutoffs,
    winsPurchased: normalized.winsPurchased,
    sessionsPurchased: normalized.sessionsPurchased,
    extras: extras.map((e) => ({ id: e.id, priceModifier: Number(e.price_modifier), priceModifierPct: Number(e.price_modifier_pct) })),
    winPackage: normalized.winPackage,
    clashTier: normalized.clashTier,
    coachPackagePrice,
    couponCode: normalized.couponCode,
  }

  const priced = computeOrderPrice(priceInput)
  if (priced.totalPrice <= 0) return { ok: false, response: badRequest(req, 'Invalid order amount') }

  return {
    ok: true,
    normalized,
    priced,
    md5MatchesRemaining,
    pdlBracket,
    coachPackagePrice,
    preferredBoosterId,
    extras,
  }
}
