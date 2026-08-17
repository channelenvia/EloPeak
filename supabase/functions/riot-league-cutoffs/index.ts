import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchLeagueCutoff } from '../_shared/riotLookup.ts'

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY') ?? ''
const PLATFORM_ROUTE = 'br1'
// 1h — split novo começou há poucos dias (LOL_SPLIT_START_TIMESTAMP), corte
// de GM/Challenger ainda pode se mover rápido; ligas grandes o bastante pra
// não valer consultar a cada visualização, mas também não tão devagar a
// ponto de defasar visivelmente o corte durante esse período.
const STALE_AFTER_MS = 60 * 60 * 1000

const bodySchema = z.object({
  queue: z.enum(['solo_duo', 'flex']).default('solo_duo'),
}).strict()

const TIERS = ['grandmaster', 'challenger'] as const

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!RIOT_API_KEY) return errorResponse(req, 'Server misconfigured', 500)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)

    const rateLimit = await consumeUserRateLimit('riot-league-cutoffs', auth.user.id, 20, 60)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req, 2 * 1024)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return errorResponse(req, 'Fila inválida', 400)
    const queue = parsedBody.data.queue

    const admin = supabaseAdmin()
    const { data: cached, error: cacheError } = await admin
      .from('riot_league_cutoffs')
      .select('tier, cutoff_lp, fetched_at')
      .eq('queue', queue)
    if (cacheError) throw cacheError

    const cutoffs: Record<string, number> = {}
    let fetchedAt: string | null = null
    let stale = false
    for (const tier of TIERS) {
      const row = cached?.find((r) => r.tier === tier)
      if (!row || Date.now() - new Date(row.fetched_at).getTime() > STALE_AFTER_MS) {
        stale = true
      } else {
        cutoffs[tier] = row.cutoff_lp
        fetchedAt = row.fetched_at
      }
    }

    if (stale) {
      for (const tier of TIERS) {
        const result = await fetchLeagueCutoff(tier, queue, RIOT_API_KEY, PLATFORM_ROUTE)
        if (result.ok) {
          cutoffs[tier] = result.cutoffLp
          const nowIso = new Date().toISOString()
          fetchedAt = nowIso
          const { error: upsertError } = await admin
            .from('riot_league_cutoffs')
            .upsert({ queue, tier, cutoff_lp: result.cutoffLp, fetched_at: nowIso }, { onConflict: 'queue,tier' })
          if (upsertError) console.error('riot-league-cutoffs upsert failed', upsertError.message)
        } else if (cutoffs[tier] === undefined) {
          // Sem cache anterior e a Riot falhou agora — sem valor confiável
          // pra devolver nesse tier. O chamador cai pro default estático
          // (MASTER_PLUS_TARGET_LP em shared/pricing.ts).
          console.error('riot-league-cutoffs fetch failed', tier, result.reason, result.status)
        }
      }
    }

    return jsonResponse(req, {
      queue,
      grandmaster_cutoff: cutoffs.grandmaster ?? null,
      challenger_cutoff: cutoffs.challenger ?? null,
      fetched_at: fetchedAt,
    })
  } catch (err) {
    console.error('riot-league-cutoffs error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
