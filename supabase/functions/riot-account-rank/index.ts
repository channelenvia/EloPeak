import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import {
  estimateLpAverages,
  fetchLeagueEntries,
  fetchRecentRankedRecord,
  fetchRankedMatchIdsThisSplit,
  fetchRiotAccount,
  NO_DIVISION_TIERS,
  RIOT_DIVISION_MAP,
  RIOT_QUEUE_TYPE,
  RIOT_TIER_MAP,
} from '../_shared/riotLookup.ts'

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY') ?? ''
const SPLIT_START_TIMESTAMP = Number(Deno.env.get('LOL_SPLIT_START_TIMESTAMP') ?? '0')
const REGIONAL_ROUTE = 'americas'
const PLATFORM_ROUTE = 'br1'

const bodySchema = z.object({
  riot_id: z.string().trim().min(3).max(32).regex(/^[^#]{1,16}#[A-Za-z0-9]{2,5}$/),
  queue: z.enum(['solo_duo', 'flex']).default('solo_duo'),
}).strict()

function badRequest(req: Request, message: string) {
  return errorResponse(req, message, 400)
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!RIOT_API_KEY) return errorResponse(req, 'Server misconfigured', 500)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)

    const rateLimit = await consumeUserRateLimit('riot-account-rank', auth.user.id, 20, 60)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req, 8 * 1024)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return badRequest(req, 'Riot ID inválido')

    const riotId = parsedBody.data.riot_id
    const queue = parsedBody.data.queue
    const { leagueQueue } = RIOT_QUEUE_TYPE[queue]

    const accountResult = await fetchRiotAccount(riotId, RIOT_API_KEY, REGIONAL_ROUTE)
    if (!accountResult.ok) {
      if (accountResult.reason === 'not_found') {
        return jsonResponse(req, { found: false, ranked: false })
      }
      if (accountResult.reason === 'rate_limited') {
        return errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503)
      }
      console.error('Riot account lookup failed', accountResult.status)
      return errorResponse(req, 'Falha ao consultar conta Riot', 502)
    }
    const account = accountResult.account

    const leagueResult = await fetchLeagueEntries(account.puuid, RIOT_API_KEY, PLATFORM_ROUTE)
    if (!leagueResult.ok) {
      if (leagueResult.reason === 'rate_limited') {
        return errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503)
      }
      console.error('Riot league lookup failed', leagueResult.status)
      return errorResponse(req, 'Falha ao consultar elo na Riot', 502)
    }

    const queueEntry = leagueResult.entries.find((entry) => entry.queueType === leagueQueue)
    const tier = queueEntry?.tier ? RIOT_TIER_MAP[queueEntry.tier] ?? null : null

    if (!queueEntry || !tier) {
      // No ranked entry for this queue — still in placements (or never played
      // ranked at all this split). MD5-eligible; count how many placement
      // games remain via Match-V5 (League-V4 has no direct field for this).
      let matchesRemaining = 5
      if (SPLIT_START_TIMESTAMP > 0) {
        const matchResult = await fetchRankedMatchIdsThisSplit(
          account.puuid, RIOT_API_KEY, REGIONAL_ROUTE, queue, SPLIT_START_TIMESTAMP,
        )
        if (matchResult.ok) matchesRemaining = Math.max(0, 5 - matchResult.matchIds.length)
      }
      return jsonResponse(req, {
        found: true,
        ranked: false,
        queue,
        riot_id: `${account.gameName}#${account.tagLine}`,
        md5_eligible: true,
        matches_remaining: matchesRemaining,
      })
    }

    const division = NO_DIVISION_TIERS.includes(tier)
      ? null
      : queueEntry.rank ? RIOT_DIVISION_MAP[queueEntry.rank] ?? null : null
    const recentRecord = await fetchRecentRankedRecord(account.puuid, RIOT_API_KEY, REGIONAL_ROUTE, queue)
    if (!recentRecord.ok) {
      if (recentRecord.reason === 'rate_limited') {
        return errorResponse(req, 'Consulta temporariamente limitada pela Riot. Tente novamente em instantes.', 503)
      }
      console.error('Riot recent matches lookup failed', recentRecord.status)
      return errorResponse(req, 'Falha ao consultar as últimas partidas na Riot', 502)
    }
    const averageLp = estimateLpAverages(tier, recentRecord.wins, recentRecord.losses)

    return jsonResponse(req, {
      found: true,
      ranked: true,
      queue,
      riot_id: `${account.gameName}#${account.tagLine}`,
      tier,
      division,
      league_points: Math.max(0, Number(queueEntry.leaguePoints ?? 0)),
      wins: Number(queueEntry.wins ?? 0),
      losses: Number(queueEntry.losses ?? 0),
      recent_matches: recentRecord.matches,
      recent_wins: recentRecord.wins,
      recent_losses: recentRecord.losses,
      md5_eligible: false,
      avg_lp_gain: averageLp.gain,
      avg_lp_loss: averageLp.loss,
      message: `Elo e LP consultados na Riot. Estimativa baseada nas últimas ${recentRecord.matches} partidas ranqueadas.`,
    })
  } catch (err) {
    console.error('riot-account-rank error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
