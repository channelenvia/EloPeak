import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'

// GoTrue has no literal "permanent" ban -- ~100 years is the practical
// equivalent (see docs/superpowers/specs/2026-08-03-booster-suspend-expel-design.md).
const PERMANENT_BAN_DURATION = '876000h'

const bodySchema = z.object({
  booster_id: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
}).strict()

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)
    const { user } = auth

    const serviceClient = supabaseAdmin()
    const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') return errorResponse(req, 'Forbidden', 403)

    const rateLimit = await consumeUserRateLimit('expel-booster', user.id, 10, 60)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return errorResponse(req, 'Body inválido', 400)
    const { booster_id: boosterId, reason } = parsedBody.data

    const { data: rpcData, error: rpcError } = await serviceClient.rpc('expel_booster', {
      p_booster_id: boosterId,
      p_reason: reason,
      p_actor_id: user.id,
    })
    const result = rpcData as { success?: boolean; error?: string; user_id?: string } | null
    if (rpcError || !result?.success) {
      return errorResponse(req, result?.error ?? 'Falha ao expulsar booster', 400)
    }

    const { error: banError } = await serviceClient.auth.admin.updateUserById(result.user_id!, {
      ban_duration: PERMANENT_BAN_DURATION,
    })
    if (banError) {
      console.error('expel-booster: status flipped but ban failed', banError.message)
      return errorResponse(req, 'booster_removed_but_ban_failed', 500)
    }

    return jsonResponse(req, { success: true })
  } catch (err) {
    console.error('expel-booster error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
