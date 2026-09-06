import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { syncOrderMatches, type OrderForMatchSync } from '../_shared/orderMatchSync.ts'

const bodySchema = z.object({
  order_id: z.string().uuid(),
}).strict()

function badRequest(req: Request, message: string) {
  return errorResponse(req, message, 400)
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)
    const { user, client: userClient } = auth

    // Reduzido de 20 -> 6 chamadas/5min: o sync automático (JobDetail, a
    // cada 30 min por pedido, e agora também cron-sync-order-matches
    // varrendo pedidos sem sync recente) cobre o caso comum, então o limite
    // aqui só precisa segurar cliques manuais repetidos, não sustentar
    // polling.
    const rateLimit = await consumeUserRateLimit('sync-order-matches', user.id, 6, 300)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req)
    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) return badRequest(req, 'Body inválido')
    const { order_id: orderId } = parsedBody.data

    // RLS (orders_customer_read/booster/admin) já restringe a leitura ao
    // cliente dono, ao booster designado ou a um admin — a checagem de
    // identidade abaixo é defesa em profundidade, mesmo padrão da
    // verify-order-rank. O botão "Sincronizar" agora aparece nas 3 telas de
    // detalhe do pedido (cliente/booster/admin), então a autorização precisa
    // aceitar qualquer um dos três, não só o booster.
    const { data: order, error: orderErr } = await userClient
      .from('orders')
      .select('id, status, customer_id, assigned_booster_id, riot_id, boost_mode, queue_type, match_sync_started_at, wins_purchased, duo_own_riot_id, service_type, current_rank, duo_current_rank')
      .eq('id', orderId)
      .maybeSingle()
    if (orderErr) return errorResponse(req, 'Failed to load order', 500)
    if (!order) return errorResponse(req, 'Order not found', 404)

    const serviceClient = supabaseAdmin()

    const isBooster = order.assigned_booster_id === user.id
    const isCustomer = order.customer_id === user.id
    let isAdmin = false
    if (!isBooster && !isCustomer) {
      const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
      isAdmin = profile?.role === 'admin'
    }
    if (!isBooster && !isCustomer && !isAdmin) {
      return errorResponse(req, 'Order not found', 404)
    }

    // A partir daqui a lógica é idêntica pra qualquer chamador (usuário ou
    // cron) -- vive em _shared/orderMatchSync.ts, único lugar que decide
    // como um pedido é sincronizado com a Riot.
    const outcome = await syncOrderMatches(order as OrderForMatchSync, serviceClient)
    return jsonResponse(req, outcome.body, outcome.status)
  } catch (err) {
    console.error('sync-order-matches error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
