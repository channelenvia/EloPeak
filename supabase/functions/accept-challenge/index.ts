import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { getChampionCatalog, normalizeChampionName, pickRandomChampion } from '../_shared/championCatalog.ts'

// Captcha do aceite de job (RN-12), 100% no servidor:
//  - issue: sorteia o campeao, grava no banco (so service_role le) e devolve apenas o id opaco do desafio
//    e a URL da imagem mascarada. A resposta nunca vai para o navegador.
//  - verify: confere a resposta (3 tentativas); acertar libera o aceite por 2 min, uma unica vez
//    (accept_boost_order consome a prova).

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('issue'), order_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('verify'), challenge_id: z.string().uuid(), answer: z.string().max(60) }).strict(),
])

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)
    const { user } = auth

    const rateLimit = await consumeUserRateLimit('accept-challenge', user.id, 30, 300)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const parsed = bodySchema.safeParse(await readJsonBody(req))
    if (!parsed.success) return errorResponse(req, 'Body inválido', 400)
    const body = parsed.data
    const db = supabaseAdmin()

    if (body.action === 'issue') {
      const { data: profile } = await db.from('booster_profiles').select('status').eq('user_id', user.id).maybeSingle()
      if (profile?.status !== 'approved') return errorResponse(req, 'booster_not_approved', 403)

      const catalog = await getChampionCatalog()
      const champion = pickRandomChampion(catalog.champions)
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
      const { data: challengeId, error } = await db.rpc('issue_accept_challenge', {
        p_booster_id: user.id,
        p_order_id: body.order_id,
        p_champion_id: champion.id,
        p_answer_norm: normalizeChampionName(champion.name),
        p_seed: seed,
      })
      if (error) {
        if (error.message.includes('order_unavailable')) return errorResponse(req, 'order_unavailable', 409)
        console.error('issue_accept_challenge error', error.message)
        return errorResponse(req, 'Internal server error', 500)
      }

      const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
      return jsonResponse(req, {
        success: true,
        challenge_id: challengeId,
        image_url: `${base}/functions/v1/accept-challenge-image?id=${challengeId}`,
        expires_in: 180,
      })
    }

    const { data, error } = await db.rpc('verify_accept_challenge', {
      p_challenge_id: body.challenge_id,
      p_booster_id: user.id,
      p_answer_norm: normalizeChampionName(body.answer),
    })
    if (error) {
      console.error('verify_accept_challenge error', error.message)
      return errorResponse(req, 'Internal server error', 500)
    }
    const result = data as { success: boolean; error?: string; attempts_left?: number } | null
    if (!result?.success) {
      return jsonResponse(req, { success: false, error: result?.error ?? 'wrong_answer', attempts_left: result?.attempts_left ?? 0 }, 200)
    }
    return jsonResponse(req, { success: true })
  } catch (err) {
    console.error('accept-challenge error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
