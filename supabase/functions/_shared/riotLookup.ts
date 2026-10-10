import { AsyncLocalStorage } from 'node:async_hooks'
import { fetchWithTimeout } from './http.ts'
import { supabaseAdmin } from './supabaseAdmin.ts'
import { alertAdmins } from './adminAlert.ts'
import { rankStep, type RankTier, type Division } from '../../../shared/pricing.ts'

// Cap curto e único retry: a Riot devolve 429 com Retry-After em segundos.
// Sem isso, syncs concorrentes de pedidos diferentes compartilhando a mesma
// API key simplesmente falhavam rápido (503 pro chamador) em vez de esperar
// a janela de rate limit da Riot passar. Um retry só (não um loop) porque
// cada function tem timeout de execução próprio -- se a Riot ainda estiver
// throttling depois do Retry-After, o chamador trata como rate_limited
// normalmente (ver os `if (resp.status === 429)` logo depois de cada chamada).
const MAX_RETRY_AFTER_SECONDS = 5

// Orcamento da chave compartilhada (checkout, verify, sync e crons), em camadas, na janela de 2 min:
//  1. cota por usuario (impede que 1 conta esgote o balde de todos);
//  2. teto das chamadas interativas (preview/checkout/avaliacao), que deixa folga para sync e verify;
//  3. balde global.
// consume_edge_rate_limit conta mesmo quando nega: sob saturacao o usuario fica travado ate a janela (2 min) virar.
// Chamada negada numa camada nao gasta as seguintes. Falha aberto se o contador estiver indisponivel.
const RIOT_BUDGET_WINDOW_SECONDS = 120
const RIOT_USER_LIMIT: Record<RiotCallTier, number> = { interactive: 30, priority: 60 }
const RIOT_INTERACTIVE_LIMIT = 60
const RIOT_GLOBAL_LIMIT = 90

export type RiotCallTier = 'interactive' | 'priority'
interface RiotCallContext { userId?: string; tier: RiotCallTier }

// Sem contexto = comportamento antigo (so o balde global, prioridade alta).
const riotContext = new AsyncLocalStorage<RiotCallContext>()

/** @public usado pelos testes Deno. Marca as chamadas Riot feitas dentro de `fn` com o usuario e a prioridade (interactive = preview/checkout; priority = sync/verify/cron). */
export function withRiotContext<T>(ctx: RiotCallContext, fn: () => Promise<T>): Promise<T> {
  return riotContext.run(ctx, fn)
}

/** Marca o resto desta requisicao (inclusive tarefas em segundo plano que ela dispara). Chamar logo apos autenticar. */
export function enterRiotContext(ctx: RiotCallContext): void {
  riotContext.enterWith(ctx)
}

type BudgetConsumer = (scope: string, subject: string, limit: number) => Promise<boolean>

const dbBudgetConsumer: BudgetConsumer = async (scope, subject, limit) => {
  const { data, error } = await supabaseAdmin().rpc('consume_edge_rate_limit', {
    p_scope: scope, p_subject: subject, p_limit: limit, p_window_seconds: RIOT_BUDGET_WINDOW_SECONDS,
  })
  // Falha aberto, mas visivel: limitador quebrado nao pode passar em silencio.
  if (error) console.error('riot budget limiter failed', scope, error.message)
  return (data as { allowed?: boolean } | null)?.allowed !== false
}

let budgetConsumer: BudgetConsumer = dbBudgetConsumer

/** @public usado pelos testes Deno (o knip nao os enxerga) */
export function setRiotBudgetConsumerForTests(consumer: BudgetConsumer | null): void {
  budgetConsumer = consumer ?? dbBudgetConsumer
}

async function riotBudgetAvailable(): Promise<boolean> {
  const ctx = riotContext.getStore() ?? { tier: 'priority' as const }
  try {
    if (ctx.userId && !await budgetConsumer('riot-user', ctx.userId, RIOT_USER_LIMIT[ctx.tier])) return false
    if (ctx.tier === 'interactive' && !await budgetConsumer('riot-interactive', 'all', RIOT_INTERACTIVE_LIMIT)) return false
    return await budgetConsumer('riot-global', 'all', RIOT_GLOBAL_LIMIT)
  } catch {
    return true
  }
}


// ── Cache curto por conta (H-27) ─────────────────────────────────────────────
// So checkout/preview passam cacheTtlSeconds; sync de partidas nunca usa (precisa do LP/rank fresco).
// Falha do cache nunca derruba a consulta.
interface RiotCacheStore {
  get(key: string): Promise<unknown | null>
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>
}

const dbCacheStore: RiotCacheStore = {
  async get(key) {
    const { data } = await supabaseAdmin().from('riot_lookup_cache')
      .select('payload').eq('cache_key', key).gt('expires_at', new Date().toISOString()).maybeSingle()
    return data?.payload ?? null
  },
  async set(key, value, ttlSeconds) {
    await supabaseAdmin().from('riot_lookup_cache').upsert({
      cache_key: key, payload: value, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
  },
}

let cacheStore: RiotCacheStore = dbCacheStore

/** @public usado pelos testes Deno (o knip nao os enxerga) */
export function setRiotCacheStoreForTests(store: { get(key: string): Promise<unknown | null>; set(key: string, value: unknown): Promise<void> } | null): void {
  cacheStore = store ?? dbCacheStore
}

export interface RiotCacheOptions { cacheTtlSeconds?: number }

async function readThroughCache<T extends { ok: boolean }>(
  key: string, ttlSeconds: number | undefined, fetcher: () => Promise<T>,
): Promise<T> {
  if (!ttlSeconds || ttlSeconds <= 0) return fetcher()
  try {
    const hit = await cacheStore.get(key)
    if (hit) return hit as T
  } catch { /* cache indisponivel: segue sem ele */ }
  const result = await fetcher()
  if (result.ok) {
    try { await cacheStore.set(key, result, ttlSeconds) } catch { /* idem */ }
  }
  return result
}

const TRANSIENT_RETRY_DELAY_MS = 400

// Timeout/queda de rede (AbortError, TypeError) viram 504 em vez de excecao: os chamadores ja mapeiam status >= 500 para upstream_error.
async function fetchRiotSafely(input: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  try {
    return await fetchWithTimeout(input, init, timeoutMs)
  } catch {
    return new Response(null, { status: 504 })
  }
}

async function fetchRiotWithRetry(
  input: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  if (!await riotBudgetAvailable()) {
    return new Response(null, { status: 429, headers: { 'retry-after': String(MAX_RETRY_AFTER_SECONDS) } })
  }
  let resp = await fetchRiotSafely(input, init, timeoutMs)
  // 5xx/timeout/rede: uma nova tentativa curta antes de desistir.
  if (resp.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS))
    resp = await fetchRiotSafely(input, init, timeoutMs)
  }
  // Chave invalida/expirada (a de desenvolvimento expira em 24 h) e incidente, nao "erro generico".
  if (resp.status === 401 || resp.status === 403) {
    void alertAdmins('riot_key_invalid', 'Chave da Riot recusada',
      `A Riot respondeu ${resp.status}: a RIOT_API_KEY pode ter expirado. Checkout, verificacao de rank e sync de partidas ficam indisponiveis ate trocar a chave.`,
      { status: resp.status }, 60)
  }
  if (resp.status !== 429) return resp

  const retryAfterSeconds = Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(1, Number(resp.headers.get('retry-after')) || 1),
  )
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000))
  return fetchRiotSafely(input, init, timeoutMs)
}


export const RIOT_TIER_MAP: Record<string, RankTier> = {
  IRON: 'iron', BRONZE: 'bronze', SILVER: 'silver', GOLD: 'gold',
  PLATINUM: 'platinum', EMERALD: 'emerald', DIAMOND: 'diamond',
  MASTER: 'master', GRANDMASTER: 'grandmaster', CHALLENGER: 'challenger',
}
export const RIOT_DIVISION_MAP: Record<string, Division> = { I: 'I', II: 'II', III: 'III', IV: 'IV' }
export const NO_DIVISION_TIERS: RankTier[] = ['master', 'grandmaster', 'challenger']

// League-V4 informa LP atual e totais de vitórias/derrotas, mas não expõe o
// LP ganho/perdido por partida. Esta estimativa única é usada pela prévia e
// pela cobrança, sempre no servidor e sem confiar em médias do navegador.
// Master+/GM/Challenger usa a mesma técnica de faixas de win rate, só que
// centrada nos 30 PDL/partida (MASTER_PLUS_LP_PER_GAME) em vez dos 22 LP do
// fluxo padrão -- mesmo desvio relativo das faixas abaixo (±13,6%/±18,2%).
export function estimateLpAverages(tier: RankTier, wins: number, losses: number): { gain: number; loss: number } {
  const total = wins + losses
  if (NO_DIVISION_TIERS.includes(tier)) {
    if (total <= 0) return { gain: 30, loss: 30 }
    const winRate = wins / total
    if (winRate < 0.48) return { gain: 26, loss: 34 }
    if (winRate > 0.55) return { gain: 35, loss: 25 }
    return { gain: 30, loss: 30 }
  }
  if (total <= 0) return { gain: 22, loss: 22 }
  const winRate = wins / total
  if (winRate < 0.48) return { gain: 19, loss: 25 }
  if (winRate > 0.55) return { gain: 26, loss: 18 }
  return { gain: 22, loss: 22 }
}

export interface RiotAccount {
  puuid: string
  gameName: string
  tagLine: string
}

export type RiotAccountResult =
  | { ok: true; account: RiotAccount }
  | { ok: false; reason: 'not_found' | 'rate_limited' | 'upstream_error'; status: number }

export async function fetchRiotAccount(
  riotId: string,
  apiKey: string,
  regionalRoute: string,
  options: RiotCacheOptions = {},
): Promise<RiotAccountResult> {
  return readThroughCache(`acct:${regionalRoute}:${riotId.trim().toLowerCase()}`, options.cacheTtlSeconds,
    () => fetchRiotAccountUncached(riotId, apiKey, regionalRoute))
}

async function fetchRiotAccountUncached(
  riotId: string,
  apiKey: string,
  regionalRoute: string,
): Promise<RiotAccountResult> {
  const hashIdx = riotId.lastIndexOf('#')
  const gameName = riotId.slice(0, hashIdx)
  const tagLine = riotId.slice(hashIdx + 1)

  const resp = await fetchRiotWithRetry(
    `https://${regionalRoute}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )

  if (resp.status === 404) return { ok: false, reason: 'not_found', status: 404 }
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }

  const body = await resp.json() as { puuid?: string; gameName?: string; tagLine?: string }
  if (!body.puuid) return { ok: false, reason: 'upstream_error', status: 502 }

  return {
    ok: true,
    account: { puuid: body.puuid, gameName: body.gameName ?? gameName, tagLine: body.tagLine ?? tagLine },
  }
}

export interface LeagueEntry {
  queueType?: string
  tier?: string
  rank?: string
  leaguePoints?: number
  wins?: number
  losses?: number
}

export type LeagueEntriesResult =
  | { ok: true; entries: LeagueEntry[] }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'wrong_region'; status: number }

export async function fetchLeagueEntries(
  puuid: string,
  apiKey: string,
  platformRoute: string,
  options: RiotCacheOptions = {},
): Promise<LeagueEntriesResult> {
  return readThroughCache(`league:${platformRoute}:${puuid}`, options.cacheTtlSeconds,
    () => fetchLeagueEntriesUncached(puuid, apiKey, platformRoute))
}

async function fetchLeagueEntriesUncached(
  puuid: string,
  apiKey: string,
  platformRoute: string,
): Promise<LeagueEntriesResult> {
  const resp = await fetchRiotWithRetry(
    `https://${platformRoute}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const entries = await resp.json() as LeagueEntry[]
  const list = Array.isArray(entries) ? entries : []
  if (list.length > 0) return { ok: true, entries: list }

  // Sem rank: conta nova no servidor ou conta de OUTRO servidor (NA/LAS). So o summoner na plataforma distingue.
  const summoner = await fetchRiotWithRetry(
    `https://${platformRoute}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (summoner.status === 404) return { ok: false, reason: 'wrong_region', status: 400 }
  if (summoner.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!summoner.ok) return { ok: false, reason: 'upstream_error', status: summoner.status }
  return { ok: true, entries: [] }
}

export const RIOT_QUEUE_TYPE: Record<'solo_duo' | 'flex', { leagueQueue: string; matchQueueId: number }> = {
  solo_duo: { leagueQueue: 'RANKED_SOLO_5x5', matchQueueId: 420 },
  flex: { leagueQueue: 'RANKED_FLEX_SR', matchQueueId: 440 },
}

export interface RankOrdinal {
  ordinal: number
  tier: RankTier
  division: Division | null
  lp: number
}

export type RankOrdinalResult =
  | { ok: true; ordinal: RankOrdinal }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'not_ranked'; status: number }

// League-V4 não expõe LP ganho/perdido POR partida (ver estimateLpAverages
// acima), mas dá pra saber se uma conta específica subiu, desceu ou ficou no
// mesmo lugar comparando dois snapshots tirados antes/depois de uma partida
// -- é assim que resolveMatchResult decide remake ("kitada") sem depender da
// heurística de timePlayed. `rankStep*1000` garante que promoção/rebaixamento
// sempre pesa mais que a variação de LP dentro da mesma divisão (LP nunca
// passa de ~100 fora de Mestre+) -- comparar só o LP cru erraria toda vez que
// a MESMA partida também promove ou rebaixa quem está sendo rastreado.
export function rankOrdinal(tier: RankTier, division: Division | null, lp: number): number {
  return rankStep(tier, division) * 1000 + lp
}

export async function fetchRankOrdinal(
  puuid: string,
  apiKey: string,
  platformRoute: string,
  leagueQueue: string,
): Promise<RankOrdinalResult> {
  const result = await fetchLeagueEntries(puuid, apiKey, platformRoute)
  if (!result.ok) {
    if (result.reason === 'wrong_region') return { ok: false, reason: 'upstream_error', status: 502 }
    return { ok: false, reason: result.reason, status: result.status }
  }
  const entry = result.entries.find((e) => e.queueType === leagueQueue)
  const tier = entry?.tier ? RIOT_TIER_MAP[entry.tier] : undefined
  if (!tier) return { ok: false, reason: 'not_ranked', status: 404 }
  const division = NO_DIVISION_TIERS.includes(tier)
    ? null
    : entry?.rank ? RIOT_DIVISION_MAP[entry.rank] ?? null : null
  if (!NO_DIVISION_TIERS.includes(tier) && !division) return { ok: false, reason: 'not_ranked', status: 404 }
  const lp = Math.max(0, Number(entry?.leaguePoints ?? 0))
  return { ok: true, ordinal: { ordinal: rankOrdinal(tier, division, lp), tier, division, lp } }
}

// Resolve o resultado (win/loss/remake) de UM lado (cliente OU duo) de uma
// partida e mantém o checkpoint de PDL/LP daquele lado atualizado, pra
// resolver o próximo remake do mesmo lote com um "antes" confiável. Fora de
// RANK_TRACKED_SERVICE_TYPES (Clash etc.) nunca gasta chamada na Riot --
// usa sempre a heurística antiga de timePlayed (ver causedRemake). Dentro de
// RANK_TRACKED, também cai pra essa heurística se a Riot falhar/a conta
// estiver sem entry na fila (unranked) -- degrada em vez de travar o sync.
export async function resolveMatchResult(params: {
  isRankTracked: boolean
  isRemake: boolean
  rawResult: 'win' | 'loss'
  body: RiotMatchV5Body
  puuid: string
  tracker: { value: number | null }
  fetchOrdinal: () => Promise<RankOrdinalResult>
  persist: (ordinal: RankOrdinal) => Promise<void>
}): Promise<'win' | 'loss' | 'remake'> {
  const { isRankTracked, isRemake, rawResult, body, puuid, tracker, fetchOrdinal, persist } = params
  const heuristicFallback = () => (isRemake ? (causedRemake(body, puuid) ? 'loss' : 'remake') : rawResult)

  if (!isRankTracked) return heuristicFallback()

  const fresh = await fetchOrdinal()
  if (!fresh.ok) return heuristicFallback()

  const before = tracker.value
  tracker.value = fresh.ordinal.ordinal
  await persist(fresh.ordinal)

  if (!isRemake) return rawResult
  if (before == null) return causedRemake(body, puuid) ? 'loss' : 'remake'
  if (fresh.ordinal.ordinal > before) return 'win'
  if (fresh.ordinal.ordinal < before) return 'loss'
  return 'remake'
}

export type LeagueCutoffResult =
  | { ok: true; cutoffLp: number }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'empty_league'; status: number }

// Challenger/Grandmaster league-v4 endpoints devolvem TODOS os jogadores da
// liga. Usado só pra estimativa de prazo do Master+ (nunca pro preço, que é
// fixo por tier -- migration 028); cacheado em riot_league_cutoffs (migration
// 074) porque essas ligas têm centenas/milhares de entries e não podem ser
// consultadas a cada visualização de pedido.
//
// O "corte" NÃO é o menor leaguePoints entre as entries -- já tentamos isso
// (e um piso fixo de LP por tier antes disso) e os dois erraram feio contra
// o op.gg. Causa raiz, confirmada inspecionando a distribuição real (BR1,
// 2026-07-18): a Riot tem um mecanismo de "escudo" de rebaixamento -- um
// jogador não sai de GM/Challenger no instante em que o LP cai abaixo do
// corte de entrada, só depois de perder partidas suficientes pra disparar o
// rebaixamento. Isso deixa uma cauda de jogadores "protegidos" no fim da
// lista, sempre com `inactive: false` (a Riot não marca isso, então esse
// campo não ajuda a filtrar). O tamanho dessa cauda varia (não é um número
// fixo de jogadores nem um piso fixo de LP), mas comparado ponto a ponto
// contra o op.gg nas 4 combinações liga×fila de BR1, o valor no percentil 93
// (de cima pra baixo, ou seja, descarta os ~7% de baixo) bateu dentro de
// 1-30 LP do valor real em todos os casos -- as outras abordagens erravam
// por centenas ou milhares de LP. Não é o algoritmo exato do op.gg (que não
// é público), é uma aproximação validada empiricamente contra o valor real.
const CUTOFF_PERCENTILE = 0.93

export async function fetchLeagueCutoff(
  tier: 'grandmaster' | 'challenger',
  queue: 'solo_duo' | 'flex',
  apiKey: string,
  platformRoute: string,
): Promise<LeagueCutoffResult> {
  const { leagueQueue } = RIOT_QUEUE_TYPE[queue]
  const path = tier === 'challenger' ? 'challengerleagues' : 'grandmasterleagues'
  const resp = await fetchRiotWithRetry(
    `https://${platformRoute}.api.riotgames.com/lol/league/v4/${path}/by-queue/${leagueQueue}`,
    { headers: { 'X-Riot-Token': apiKey } },
    15_000,
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }

  const body = await resp.json() as { entries?: { leaguePoints?: number; inactive?: boolean }[] }
  const entries = body.entries ?? []
  const active = entries.filter((e) => e.inactive !== true)
  const points = (active.length > 0 ? active : entries)
    .map((e) => e.leaguePoints)
    .filter((lp): lp is number => typeof lp === 'number')
  if (points.length === 0) return { ok: false, reason: 'empty_league', status: 502 }

  const sortedDesc = [...points].sort((a, b) => b - a)
  const cutoffIndex = Math.min(sortedDesc.length - 1, Math.floor(sortedDesc.length * CUTOFF_PERCENTILE))
  const cutoffLp = sortedDesc[cutoffIndex]

  return { ok: true, cutoffLp }
}

export type MatchIdsResult =
  | { ok: true; matchIds: string[] }
  | { ok: false; reason: 'rate_limited' | 'upstream_error'; status: number }

export type RecentRankedRecordResult =
  | { ok: true; wins: number; losses: number; matches: number }
  | { ok: false; reason: 'rate_limited' | 'upstream_error'; status: number }

// Match-V5 não traz delta de LP, mas permite usar o desempenho real das dez
// partidas ranqueadas mais recentes como base da estimativa de ganho/perda.
export async function fetchRecentRankedRecord(
  puuid: string,
  apiKey: string,
  regionalRoute: string,
  queue: 'solo_duo' | 'flex',
): Promise<RecentRankedRecordResult> {
  const { matchQueueId } = RIOT_QUEUE_TYPE[queue]
  const idsResp = await fetchRiotWithRetry(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
    + `?queue=${matchQueueId}&start=0&count=10`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (idsResp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!idsResp.ok) return { ok: false, reason: 'upstream_error', status: idsResp.status }

  const matchIds = await idsResp.json() as string[]
  if (!Array.isArray(matchIds) || matchIds.length === 0) return { ok: true, wins: 0, losses: 0, matches: 0 }

  const details = await Promise.all(matchIds.map(async (matchId) => {
    const resp = await fetchRiotWithRetry(
      `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
      { headers: { 'X-Riot-Token': apiKey } },
    )
    if (resp.status === 429) return { ok: false as const, reason: 'rate_limited' as const, status: 429 }
    if (!resp.ok) return { ok: false as const, reason: 'upstream_error' as const, status: resp.status }
    const body = await resp.json() as { info?: { participants?: Array<{ puuid?: string; win?: boolean }> } }
    const participant = body.info?.participants?.find((candidate) => candidate.puuid === puuid)
    if (!participant || typeof participant.win !== 'boolean') {
      return { ok: false as const, reason: 'upstream_error' as const, status: 502 }
    }
    return { ok: true as const, win: participant.win }
  }))

  const failed = details.find((detail) => !detail.ok)
  if (failed && !failed.ok) return failed
  const wins = details.filter((detail) => detail.ok && detail.win).length
  return { ok: true, wins, losses: details.length - wins, matches: details.length }
}

// Placement-matches-remaining has no direct League-V4 field — Match-V5 is the
// only way to count ranked games played this split. `splitStartEpochSeconds`
// must be updated whenever Riot starts a new split (see LOL_SPLIT_START_TIMESTAMP
// in supabase/functions/README.md).
export async function fetchRankedMatchIdsThisSplit(
  puuid: string,
  apiKey: string,
  regionalRoute: string,
  queue: 'solo_duo' | 'flex',
  splitStartEpochSeconds: number,
): Promise<MatchIdsResult> {
  const { matchQueueId } = RIOT_QUEUE_TYPE[queue]
  const resp = await fetchRiotWithRetry(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
    + `?queue=${matchQueueId}&startTime=${splitStartEpochSeconds}&count=10`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const matchIds = await resp.json() as string[]
  return { ok: true, matchIds: Array.isArray(matchIds) ? matchIds : [] }
}

// ── Sincronização automática de partidas de um pedido (sync-order-matches) ──

// Mais recentes primeiro (ordem nativa da Match-V5) — startTime em epoch
// segundos, sempre orders.match_sync_started_at, nunca partidas anteriores
// ao início do boost.
const MATCH_IDS_PAGE_SIZE = 100
const MATCH_IDS_MAX_PAGES = 3 // teto de seguranca: 300 partidas por sync

export async function fetchMatchIdsSince(
  puuid: string,
  apiKey: string,
  regionalRoute: string,
  matchQueueId: number,
  startTimeEpochSeconds: number,
  count = MATCH_IDS_PAGE_SIZE,
): Promise<MatchIdsResult> {
  // Pagina de `count` em `count`: pedir so as 20 mais recentes perdia as antigas quando o pedido ficava sem sync.
  const all: string[] = []
  for (let page = 0; page < MATCH_IDS_MAX_PAGES; page++) {
    const resp = await fetchRiotWithRetry(
      `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
      + `?queue=${matchQueueId}&startTime=${startTimeEpochSeconds}&start=${page * count}&count=${count}`,
      { headers: { 'X-Riot-Token': apiKey } },
    )
    // Falha no meio da paginacao nunca devolve uma lista parcial como se fosse completa.
    if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
    if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
    const ids = await resp.json() as string[]
    const pageIds = Array.isArray(ids) ? ids : []
    all.push(...pageIds)
    if (pageIds.length < count) break
  }
  return { ok: true, matchIds: all }
}

export interface MatchDetail {
  externalMatchId: string
  result: 'win' | 'loss'
  champion: string | null
  kills: number
  deaths: number
  assists: number
  queueId: number | null
  durationSeconds: number | null
  playedAt: string
  minionsKilled: number
  neutralMinionsKilled: number
  isMvp: boolean
  visionScore: number | null
}

// Remake ("deu kita"): a Riot encerra a votação de remake por volta dos 3min
// quando alguém cai/fica AFK no início -- sem LP em jogo, sem gameplay real.
// A API não expõe uma flag explícita, então usamos gameDuration como proxy
// (mesma técnica usada por trackers como op.gg): nenhuma partida real termina
// antes disso -- nem um FF, que só libera aos 15min. 300s dá folga
// confortável acima dos ~3min reais do remake, sem risco de cortar uma
// partida legítima.
const REMAKE_MAX_DURATION_SECONDS = 300

export function isRemakeMatch(body: RiotMatchV5Body): boolean {
  const duration = body.info?.gameDuration
  return typeof duration === 'number' && duration > 0 && duration < REMAKE_MAX_DURATION_SECONDS
}

// Quem causou o remake: também sem flag explícita na API, mas
// participants[].timePlayed (quanto tempo ESSE jogador ficou conectado,
// distinto de gameDuration = duração total da partida) denuncia quem não
// conectou/saiu -- quem ficou até o fim tem timePlayed ≈ gameDuration; quem
// kitou fica bem abaixo disso (tipicamente perto de 0). Checa isRemakeMatch
// internamente (não confia no chamador lembrar) -- fora desse contexto o
// resultado não tem sentido (toda partida real tem timePlayed ≈ gameDuration
// pra todo mundo, um jogador só ficando "menos tempo" no meio de uma partida
// de verdade não significa que ele causou nada).
// Duo so conta se a conta registrada jogou no MESMO time do cliente (estar na partida, de qualquer lado, nao basta).
export function onSameTeam(body: RiotMatchV5Body, puuidA: string, puuidB: string): boolean {
  const participants = body.info?.participants ?? []
  const a = participants.find((p) => p.puuid === puuidA)
  const b = participants.find((p) => p.puuid === puuidB)
  return a?.teamId != null && b?.teamId != null && a.teamId === b.teamId
}

export function causedRemake(body: RiotMatchV5Body, puuid: string): boolean {
  if (!isRemakeMatch(body)) return false
  const gameDuration = body.info!.gameDuration!
  const participant = body.info?.participants?.find((candidate) => candidate.puuid === puuid)
  if (!participant || typeof participant.timePlayed !== 'number') return false
  return participant.timePlayed < gameDuration * 0.5
}

export type MatchDetailResult =
  | { ok: true; detail: MatchDetail }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'participant_not_found' | 'missing_played_at'; status: number }

interface RiotParticipant {
  puuid?: string
  win?: boolean
  championName?: string
  kills?: number
  deaths?: number
  assists?: number
  teamId?: number
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
  visionScore?: number
  timePlayed?: number
}

export interface RiotMatchV5Body {
  info?: {
    queueId?: number
    gameDuration?: number
    gameEndTimestamp?: number
    participants?: RiotParticipant[]
  }
}

function kdaOf(p: Pick<RiotParticipant, 'kills' | 'deaths' | 'assists'>): number {
  return ((p.kills ?? 0) + (p.assists ?? 0)) / Math.max(1, p.deaths ?? 0)
}

// Pura -- só depende do JSON já buscado, sem I/O. Extraída de
// fetchMatchDetail pra ser testável sem mockar fetch (ver riotLookup.test.ts).
export function parseMatchDetail(body: RiotMatchV5Body, puuid: string, matchId: string): MatchDetailResult {
  const participants = body.info?.participants ?? []
  const participant = participants.find((candidate) => candidate.puuid === puuid)
  if (!participant || typeof participant.win !== 'boolean') {
    return { ok: false, reason: 'participant_not_found', status: 502 }
  }
  // gameEndTimestamp ausente é uma partida malformada -- played_at alimenta a
  // janela de atribuição de booster em record_order_match/record_duo_match,
  // então cair pro "agora" atribuiria a partida a quem está ATUALMENTE
  // designado em vez de quem de fato jogou. Melhor pular/retentar depois do
  // que gravar um played_at inventado.
  if (typeof body.info?.gameEndTimestamp !== 'number') {
    return { ok: false, reason: 'missing_played_at', status: 502 }
  }

  // MVP = maior KDA entre os 5 do mesmo teamId (empate conta pros dois --
  // usa >= contra o máximo do time, não > estrito). Se teamId vier ausente
  // (não deveria em match-v5 normal), trata o próprio jogador como "time" de
  // 1 -- sempre MVP nesse caso degenerado, em vez de quebrar.
  const teammates = participant.teamId != null
    ? participants.filter((p) => p.teamId === participant.teamId)
    : [participant]
  const bestTeamKda = Math.max(...teammates.map(kdaOf))
  const isMvp = kdaOf(participant) >= bestTeamKda

  return {
    ok: true,
    detail: {
      externalMatchId: matchId,
      result: participant.win ? 'win' : 'loss',
      champion: participant.championName ?? null,
      kills: participant.kills ?? 0,
      deaths: participant.deaths ?? 0,
      assists: participant.assists ?? 0,
      queueId: body.info?.queueId ?? null,
      durationSeconds: body.info?.gameDuration ?? null,
      playedAt: new Date(body.info.gameEndTimestamp).toISOString(),
      minionsKilled: participant.totalMinionsKilled ?? 0,
      neutralMinionsKilled: participant.neutralMinionsKilled ?? 0,
      isMvp,
      visionScore: participant.visionScore ?? null,
    },
  }
}

// Uma partida por vez (Match-V5 não expõe um endpoint em lote) — o
// participante é localizado pelo puuid, nunca por posição/index.
export type MatchBodyResult =
  | { ok: true; body: RiotMatchV5Body }
  | { ok: false; reason: 'rate_limited' | 'upstream_error'; status: number }

// Separado de fetchMatchDetail pra permitir ler o resultado de MAIS DE UM
// participante (cliente + conta duo) na mesma partida sem duas chamadas HTTP
// -- ver sync-order-matches, que chama parseMatchDetail duas vezes em cima
// do mesmo body pra atribuir a partida a cada lado corretamente.
export async function fetchMatchBody(
  matchId: string,
  apiKey: string,
  regionalRoute: string,
): Promise<MatchBodyResult> {
  const resp = await fetchRiotWithRetry(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }

  const body = await resp.json() as RiotMatchV5Body
  return { ok: true, body }
}

// ── Verificacao de elo declarado (rankAssessment) ───────────────────────────

export type SummonerLevelResult =
  | { ok: true; level: number }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'not_found'; status: number }

export async function fetchSummonerLevel(puuid: string, apiKey: string, platformRoute: string): Promise<SummonerLevelResult> {
  const resp = await fetchRiotWithRetry(
    `https://${platformRoute}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 404) return { ok: false, reason: 'not_found', status: 404 }
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const body = await resp.json() as { summonerLevel?: number }
  return typeof body.summonerLevel === 'number' ? { ok: true, level: body.summonerLevel } : { ok: false, reason: 'upstream_error', status: 502 }
}

// Partidas ranqueadas num intervalo [startTime, endTime] (epoch segundos), mais recentes primeiro.
export async function fetchRankedMatchIdsInWindow(
  puuid: string,
  apiKey: string,
  regionalRoute: string,
  matchQueueId: number,
  startTimeEpochSeconds: number,
  endTimeEpochSeconds: number,
  count = 20,
): Promise<MatchIdsResult> {
  const resp = await fetchRiotWithRetry(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
    + `?queue=${matchQueueId}&startTime=${startTimeEpochSeconds}&endTime=${endTimeEpochSeconds}&count=${count}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const ids = await resp.json() as string[]
  return { ok: true, matchIds: Array.isArray(ids) ? ids : [] }
}
