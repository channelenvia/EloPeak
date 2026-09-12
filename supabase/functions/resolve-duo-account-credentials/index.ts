import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'

// Mesmo padrão da resolve-order-credentials: o painel do booster nunca exibe
// login/senha da conta Duo, só um token opaco (get_duo_account_access_token).
// Essa função é o único caminho autenticado para resgatar o token — a
// identidade do booster vem da sessão verificada, nunca do corpo da
// requisição, então um token só pode ser resgatado por quem o emitiu.

const bodySchema = z.object({
  access_token: z.string().min(1).max(8192),
}).strict()

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)
    const { user } = auth

    const rateLimit = await consumeUserRateLimit('resolve-duo-account-credentials', user.id, 40, 300)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return errorResponse(req, 'Body inválido', 400)
    const { access_token: accessToken } = parsedBody.data

    const serviceClient = supabaseAdmin()
    const { data, error } = await serviceClient.rpc('resolve_duo_account_access_token', {
      p_access_token: accessToken,
      p_booster_user_id: user.id,
    })
    if (error) {
      console.error('resolve_duo_account_access_token error', error.message)
      return errorResponse(req, 'Internal server error', 500)
    }

    const result = data as { success: boolean; account_id?: string; login?: string; password?: string; error?: string } | null
    if (!result?.success || !result.login || !result.password) {
      return errorResponse(req, result?.error ?? 'invalid_token', 400)
    }

    return jsonResponse(req, {
      success: true,
      account_id: result.account_id,
      login: result.login,
      password: result.password,
    })
  } catch (err) {
    console.error('resolve-duo-account-credentials error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
