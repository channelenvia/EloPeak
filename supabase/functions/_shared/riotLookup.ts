import { fetchWithTimeout } from './http.ts'
import type { RankTier, Division } from '../../../shared/pricing.ts'

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
): Promise<RiotAccountResult> {
  const hashIdx = riotId.lastIndexOf('#')
  const gameName = riotId.slice(0, hashIdx)
  const tagLine = riotId.slice(hashIdx + 1)

  const resp = await fetchWithTimeout(
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
  | { ok: false; reason: 'rate_limited' | 'upstream_error'; status: number }

export async function fetchLeagueEntries(
  puuid: string,
  apiKey: string,
  platformRoute: string,
): Promise<LeagueEntriesResult> {
  const resp = await fetchWithTimeout(
    `https://${platformRoute}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const entries = await resp.json() as LeagueEntry[]
  return { ok: true, entries: Array.isArray(entries) ? entries : [] }
}

export const RIOT_QUEUE_TYPE: Record<'solo_duo' | 'flex', { leagueQueue: string; matchQueueId: number }> = {
  solo_duo: { leagueQueue: 'RANKED_SOLO_5x5', matchQueueId: 420 },
  flex: { leagueQueue: 'RANKED_FLEX_SR', matchQueueId: 440 },
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
  const resp = await fetchWithTimeout(
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
  console.log(
    'riot-league-cutoffs computed', tier, queue,
    'entries', entries.length, 'active', active.length,
    'cutoffLp', cutoffLp, 'min', sortedDesc[sortedDesc.length - 1], 'max', sortedDesc[0],
  )

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
  const idsResp = await fetchWithTimeout(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
    + `?queue=${matchQueueId}&start=0&count=10`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (idsResp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!idsResp.ok) return { ok: false, reason: 'upstream_error', status: idsResp.status }

  const matchIds = await idsResp.json() as string[]
  if (!Array.isArray(matchIds) || matchIds.length === 0) return { ok: true, wins: 0, losses: 0, matches: 0 }

  const details = await Promise.all(matchIds.map(async (matchId) => {
    const resp = await fetchWithTimeout(
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
  const resp = await fetchWithTimeout(
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
export async function fetchMatchIdsSince(
  puuid: string,
  apiKey: string,
  regionalRoute: string,
  matchQueueId: number,
  startTimeEpochSeconds: number,
  count = 20,
): Promise<MatchIdsResult> {
  const resp = await fetchWithTimeout(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
    + `?queue=${matchQueueId}&startTime=${startTimeEpochSeconds}&count=${count}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }
  const matchIds = await resp.json() as string[]
  return { ok: true, matchIds: Array.isArray(matchIds) ? matchIds : [] }
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
export function causedRemake(body: RiotMatchV5Body, puuid: string): boolean {
  if (!isRemakeMatch(body)) return false
  const gameDuration = body.info!.gameDuration!
  const participant = body.info?.participants?.find((candidate) => candidate.puuid === puuid)
  if (!participant || typeof participant.timePlayed !== 'number') return false
  return participant.timePlayed < gameDuration * 0.5
}

export type MatchDetailResult =
  | { ok: true; detail: MatchDetail }
  | { ok: false; reason: 'rate_limited' | 'upstream_error' | 'participant_not_found'; status: number }

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
      playedAt: new Date((body.info?.gameEndTimestamp ?? Date.now())).toISOString(),
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
  const resp = await fetchWithTimeout(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
    { headers: { 'X-Riot-Token': apiKey } },
  )
  if (resp.status === 429) return { ok: false, reason: 'rate_limited', status: 429 }
  if (!resp.ok) return { ok: false, reason: 'upstream_error', status: resp.status }

  const body = await resp.json() as RiotMatchV5Body
  return { ok: true, body }
}
