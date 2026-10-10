import { RANK_TIER_ORDER, type RankTier } from '../../../shared/pricing.ts'
import {
  fetchLeagueEntries, fetchMatchBody, fetchRankedMatchIdsInWindow, fetchSummonerLevel, RIOT_QUEUE_TYPE, RIOT_TIER_MAP,
} from './riotLookup.ts'

// Verificacao do PROPRIO SISTEMA para elo declarado pelo cliente (a Riot nao tem rank / elo da temporada passada):
// estima o elo pela qualidade dos lobbies das partidas ranqueadas da conta e compara com o declarado.
// E um indicio para o admin conferir, nunca um bloqueio automatico.

export type AssessmentStatus = 'consistent' | 'suspicious' | 'inconclusive'

export interface AssessmentSummary {
  declared_low: RankTier
  declared_high: RankTier
  estimated_tier: RankTier | null
  sampled_players: number
  sampled_matches: number
  ranked_games_found: number
  summoner_level: number | null
  notes: string[]
}

const MIN_SAMPLED_PLAYERS = 4
const ACCEPTED_TIER_DISTANCE = 1

function tierIndex(tier: RankTier): number {
  return RANK_TIER_ORDER.indexOf(tier)
}

function medianTier(tiers: RankTier[]): RankTier {
  const sorted = [...tiers].sort((a, b) => tierIndex(a) - tierIndex(b))
  return sorted[Math.floor(sorted.length / 2)]
}

export function classifyAssessment(input: {
  serviceType: string
  declaredLow: RankTier
  declaredHigh: RankTier
  rankedGamesFound: number
  sampledTiers: RankTier[]
  summonerLevel: number | null
  sampledMatches?: number
  /** Riot com erro/429: nao ha como saber, nunca e indicio de fraude. */
  riotUnavailable?: boolean
}): { status: AssessmentStatus; summary: AssessmentSummary } {
  const notes: string[] = []
  const estimated = input.sampledTiers.length >= MIN_SAMPLED_PLAYERS ? medianTier(input.sampledTiers) : null
  const summary: AssessmentSummary = {
    declared_low: input.declaredLow,
    declared_high: input.declaredHigh,
    estimated_tier: estimated,
    sampled_players: input.sampledTiers.length,
    sampled_matches: input.sampledMatches ?? 0,
    ranked_games_found: input.rankedGamesFound,
    summoner_level: input.summonerLevel,
    notes,
  }

  if (input.riotUnavailable) {
    notes.push('A Riot ficou indisponivel durante a verificacao: confira manualmente.')
    return { status: 'inconclusive', summary }
  }

  if (input.rankedGamesFound === 0) {
    if (input.serviceType === 'md5') {
      notes.push('Nenhuma partida ranqueada encontrada na temporada passada: o elo declarado nao tem historico que o sustente.')
      return { status: 'suspicious', summary }
    }
    notes.push('Nenhuma partida ranqueada encontrada: nao ha como estimar o elo.')
    return { status: 'inconclusive', summary }
  }
  if (!estimated) {
    notes.push('Amostra de jogadores pequena demais para estimar o elo.')
    return { status: 'inconclusive', summary }
  }

  const lo = tierIndex(input.declaredLow) - ACCEPTED_TIER_DISTANCE
  const hi = tierIndex(input.declaredHigh) + ACCEPTED_TIER_DISTANCE
  const idx = tierIndex(estimated)
  if (idx < lo) {
    notes.push(`Os lobbies indicam ~${estimated}, abaixo do elo declarado: o cliente pode ter declarado um elo maior que o real.`)
    return { status: 'suspicious', summary }
  }
  if (idx > hi) {
    notes.push(`Os lobbies indicam ~${estimated}, acima do elo declarado: o cliente pode ter declarado um elo menor para pagar menos.`)
    return { status: 'suspicious', summary }
  }
  notes.push(`Os lobbies indicam ~${estimated}, compativel com o elo declarado.`)
  return { status: 'consistent', summary }
}

const MAX_SAMPLED_MATCHES = 3
const MAX_SAMPLED_PLAYERS = 12
const WINDOW_DAYS_DEFAULT = 400
const WINDOW_DAYS_SPLIT = 220
const SECONDS_PER_DAY = 86_400

export async function runRankAssessment(params: {
  puuid: string
  riotApiKey: string
  serviceType: string
  queueType: 'solo_duo' | 'flex'
  declaredLow: RankTier
  declaredHigh: RankTier
  splitStartEpochSeconds?: number
}): Promise<{ status: AssessmentStatus; summary: AssessmentSummary }> {
  const { puuid, riotApiKey, serviceType, queueType, declaredLow, declaredHigh } = params
  const nowSeconds = Math.floor(Date.now() / 1000)
  // MD5 declara o elo da temporada passada: olha so partidas ANTES do inicio da temporada atual.
  const isPastSeason = serviceType === 'md5' && !!params.splitStartEpochSeconds
  const endTime = isPastSeason ? params.splitStartEpochSeconds! : nowSeconds
  const startTime = endTime - (isPastSeason ? WINDOW_DAYS_SPLIT : WINDOW_DAYS_DEFAULT) * SECONDS_PER_DAY

  try {
    const [level, ids] = await Promise.all([
      fetchSummonerLevel(puuid, riotApiKey, 'br1'),
      fetchRankedMatchIdsInWindow(puuid, riotApiKey, 'americas', RIOT_QUEUE_TYPE[queueType].matchQueueId, startTime, endTime),
    ])
    const summonerLevel = level.ok ? level.level : null
    if (!ids.ok) {
      return classifyAssessment({ serviceType, declaredLow, declaredHigh, rankedGamesFound: 0, sampledTiers: [], summonerLevel, sampledMatches: 0, riotUnavailable: true })
    }

    const others = new Set<string>()
    let sampledMatches = 0
    for (const matchId of ids.matchIds.slice(0, MAX_SAMPLED_MATCHES)) {
      const match = await fetchMatchBody(matchId, riotApiKey, 'americas')
      if (!match.ok) continue
      sampledMatches += 1
      for (const p of match.body.info?.participants ?? []) {
        if (p.puuid && p.puuid !== puuid && others.size < MAX_SAMPLED_PLAYERS) others.add(p.puuid)
      }
    }

    const tiers: RankTier[] = []
    const { leagueQueue } = RIOT_QUEUE_TYPE[queueType]
    for (const other of others) {
      const league = await fetchLeagueEntries(other, riotApiKey, 'br1')
      if (!league.ok) continue
      const entry = league.entries.find((e) => e.queueType === leagueQueue)
      const tier = entry?.tier ? RIOT_TIER_MAP[entry.tier] : undefined
      if (tier) tiers.push(tier)
    }

    return classifyAssessment({
      serviceType, declaredLow, declaredHigh, rankedGamesFound: ids.matchIds.length, sampledTiers: tiers, summonerLevel, sampledMatches,
    })
  } catch (err) {
    console.error('rank assessment failed', err)
    return classifyAssessment({ serviceType, declaredLow, declaredHigh, rankedGamesFound: 1, sampledTiers: [], summonerLevel: null })
  }
}
