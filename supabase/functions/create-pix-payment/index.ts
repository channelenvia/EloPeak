import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { validateAndPriceIntent } from '../_shared/orderPricing.ts'

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY') ?? ''

const bodySchema = z.object({
  order_id: z.string().uuid().optional(),
  intent: z.record(z.unknown()).optional(),
  idempotency_key: z.string().uuid().optional(),
  // Persiste/recupera o pedido sem criar cobrança no Mercado Pago. A mesma
  // rota mantém validação e preço autoritativos para não duplicar regras.
  save_only: z.boolean().default(false),
  // Booster escolhido pelo cliente no perfil público (opcional, só usado ao
  // criar um pedido novo — ignorado no caminho de retry via order_id).
  preferred_booster_id: z.string().uuid().optional(),
}).strict().refine((body) => Boolean(body.order_id) !== Boolean(body.intent), {
  message: 'Informe exatamente um entre order_id e intent',
}).refine((body) => !body.intent || Boolean(body.idempotency_key), {
  message: 'idempotency_key é obrigatório ao criar um pedido novo (intent)',
  path: ['idempotency_key'],
})

function badRequest(req: Request, message: string) {
  return errorResponse(req, message, 400)
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!MP_ACCESS_TOKEN || !SUPABASE_URL) {
      return errorResponse(req, 'Server misconfigured', 500)
    }

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)

    // Endpoint mais caro do sistema (cria pedido, gera QR PIX na Mercado Pago,
    // pode consultar a Riot) — limite mais apertado que os outros endpoints
    // autenticados, mas ainda folgado o bastante pra um retry legítimo depois
    // de falha de rede.
    const rateLimit = await consumeUserRateLimit('create-pix-payment', auth.user.id, 6, 60)
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

    const rawBody = await readJsonBody(req)

    const parsedBody = bodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return jsonResponse(req, {
        error: 'Body inválido',
        issues: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }, 400)
    }

    const body = parsedBody.data
    const userClient = auth.client
    const { user } = auth
    const serviceClient = supabaseAdmin()
    let requestedOrderId = body.order_id

    if (!requestedOrderId && body.idempotency_key) {
      const { data: previous, error: previousError } = await serviceClient
        .from('orders')
        .select('id')
        .eq('customer_id', user.id)
        .eq('idempotency_key', body.idempotency_key)
        .maybeSingle()
      if (previousError) return errorResponse(req, 'Failed to check idempotency key', 500)
      requestedOrderId = previous?.id
    }

    let orderId: string
    let order: { id: string; customer_id: string; total_price: number; mp_payment_id: string | null }

    if (requestedOrderId) {
      // ── Retry path: reuse an order already created by this function ──────────
      orderId = requestedOrderId

      const { data: existingOrder, error: orderErr } = await userClient
        .from('orders')
        .select('id, customer_id, total_price, status, mp_payment_id')
        .eq('id', orderId)
        .single()

      if (orderErr || !existingOrder) return errorResponse(req, 'Order not found', 404)
      if (existingOrder.customer_id !== user.id) return errorResponse(req, 'Forbidden', 403)
      if (existingOrder.status !== 'awaiting_payment') return badRequest(req, 'Order is not awaiting payment')

      order = existingOrder
    } else if (body.intent) {
      // ── New order: server decides the flow, validates it and computes the
      // authoritative price. Nothing about rank/mode/addon compatibility is
      // trusted from the client beyond "which combination are you asking for".

      // Limite de 2 pedidos "aguardando pagamento" simultâneos por cliente --
      // sem isso, o configurador (que agora permite sair do popup de PIX sem
      // cancelar o pedido, ver "Sair e reiniciar") deixava o cliente acumular
      // pedidos pendentes sem limite. Checado ANTES de validar/precificar o
      // intent (que pode chamar a API da Riot) pra não gastar essa chamada
      // numa tentativa que vai ser rejeitada de qualquer jeito.
      const { count: pendingCount, error: pendingCountErr } = await serviceClient
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', user.id)
        .eq('status', 'awaiting_payment')
      if (pendingCountErr) return errorResponse(req, 'Failed to check pending orders', 500)
      if ((pendingCount ?? 0) >= 2) {
        return badRequest(req, 'Você já tem 2 pedidos aguardando pagamento. Pague ou cancele um deles em Meus Pedidos antes de criar outro.')
      }

      const outcome = await validateAndPriceIntent(
        req, body.intent, user.id, serviceClient, RIOT_API_KEY, body.preferred_booster_id ?? null,
      )
      if (!outcome.ok) return outcome.response
      const { normalized, priced, md5MatchesRemaining, pdlBracket, preferredBoosterId, extras } = outcome

      // Reconstrói o shape específico de `orders.extras` a partir dos extras
      // já validados e precificados — o formato de linha de pedido (extra_id/
      // percentage/price) é específico deste insert, não faz parte da
      // cotação genérica que order-quote também consome.
      const extrasJson = extras.map((e) => {
        const b = priced.extrasBreakdown.find((x) => x.id === e.id)
        return {
          extra_id: e.id,
          code: e.code,
          name: e.name,
          percentage: Number(e.price_modifier_pct),
          price: b?.price ?? 0,
          sort_order: e.sort_order,
        }
      })

      const { data: inserted, error: insertErr } = await serviceClient
        .from('orders')
        .insert({
          customer_id: user.id,
          service_id: normalized.serviceId,
          service_type: normalized.serviceType,
          game_id: normalized.gameId,
          status: 'awaiting_payment',
          queue_type: normalized.queueType,
          boost_mode: normalized.boostMode,
          server: normalized.server,
          current_rank: normalized.currentRank as never,
          target_rank: normalized.targetRank as never,
          clash_tier: normalized.clashTier,
          clash_day: normalized.clashDay,
          wins_purchased: normalized.winsPurchased,
          sessions_purchased: normalized.sessionsPurchased,
          extras: extrasJson as never,
          win_package: normalized.winPackage,
          base_price: priced.basePrice,
          extras_price: priced.extrasPrice,
          // coupon_code é gravado só quando o desconto foi de fato aplicado
          // (nunca a partir do que o cliente digitou/tentou) -- case-sensitive,
          // então o valor gravado aqui é sempre o texto exato cadastrado em
          // VALID_COUPONS (applyCoupon já rejeitou qualquer variação de caixa).
          coupon_code: priced.couponApplied ? normalized.couponCode!.trim() : null,
          discount_price: priced.discountPrice,
          total_price: priced.totalPrice,
          estimated_hours: priced.estimatedHours,
          customer_notes: normalized.customerNotes || null,
          current_pdl: normalized.currentPdl,
          pdl_bracket: pdlBracket,
          avg_pdl_gain: normalized.avgPdlGain,
          avg_pdl_loss: normalized.avgPdlLoss,
          pricing_version: 'v2',
          idempotency_key: body.idempotency_key ?? null,
          preferred_booster_id: preferredBoosterId,
          riot_id: normalized.riotId,
          booster_service_id: normalized.boosterServiceId,
          md5_matches_remaining: md5MatchesRemaining,
          customer_lanes: normalized.customerLanes.length ? normalized.customerLanes : null,
        })
        .select('id, customer_id, total_price, mp_payment_id')
        .single()

      if (insertErr || !inserted) {
        if (insertErr?.code === '23505' && body.idempotency_key) {
          const { data: raced } = await serviceClient
            .from('orders')
            .select('id, customer_id, total_price, mp_payment_id')
            .eq('customer_id', user.id)
            .eq('idempotency_key', body.idempotency_key)
            .maybeSingle()
          if (raced) {
            orderId = raced.id
            order = raced
          } else {
            return errorResponse(req, 'Order creation conflict', 409)
          }
        } else {
          // Keep database details out of the HTTP response, but retain enough
          // structured context in Edge Function logs to diagnose constraints.
          console.error('create-pix-payment order insert failed', {
            code: insertErr?.code ?? 'missing_inserted_row',
            message: insertErr?.message ?? 'Insert returned no row',
            details: insertErr?.details ?? null,
            hint: insertErr?.hint ?? null,
            serviceType: normalized.serviceType,
          })
          return errorResponse(req, 'Failed to create order', 500)
        }
      } else {
        orderId = inserted.id
        order = inserted
      }
    } else {
      return badRequest(req, 'Missing order_id or intent')
    }

    // Amount is always derived from the DB row we just read/created — never
    // recomputed from anything the client sends at this point.
    if (!order.total_price || Number(order.total_price) <= 0) {
      return jsonResponse(req, { error: 'Invalid order amount', order_id: orderId }, 400)
    }

    // O pedido deve aparecer em "Meus pedidos" assim que a configuração é
    // concluída. A cobrança PIX só nasce depois, em um segundo request feito
    // pelo clique explícito do usuário.
    if (body.save_only) {
      return jsonResponse(req, {
        success: true,
        saved: true,
        order_id: orderId,
        total_price: Number(order.total_price),
      })
    }

    // If there is already a pending MP payment for this order, try to reuse it
    if (order.mp_payment_id) {
      const existing = await fetchWithTimeout(
        `https://api.mercadopago.com/v1/payments/${order.mp_payment_id}`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } },
      )
      if (existing.ok) {
        const mp = await existing.json()
        // pending or in_process: return the existing QR code
        if (mp.status === 'pending' || mp.status === 'in_process') {
          return jsonResponse(req, {
            order_id: orderId,
            total_price: order.total_price,
            payment_id: mp.id,
            qr_code: mp.point_of_interaction?.transaction_data?.qr_code,
            qr_code_base64: mp.point_of_interaction?.transaction_data?.qr_code_base64,
            expires_at: mp.date_of_expiration,
            reused: true,
          })
        }
        // MP already shows this payment as approved but our webhook hasn't
        // landed yet (delivery lag) — the order row can still read
        // 'awaiting_payment' in this exact window. Falling through to
        // "create new PIX payment" below would re-POST with the same
        // idempotency key (no double charge, MP replays the approved
        // payment) but hand the client a stale/misleading "unpaid" response.
        // Tell the truth instead: this order is already paid.
        if (mp.status === 'approved') {
          return errorResponse(req, 'Este pedido já foi pago — atualize a página.', 409, 'ALREADY_PAID', { order_id: orderId })
        }
      }
    }

    // Create new PIX payment via Mercado Pago API
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    // Amount sourced exclusively from the order row — client cannot influence this value
    const amountBrl = Number(order.total_price)

    const mpResp = await fetchWithTimeout('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Idempotency key is scoped to the order itself — each order only
        // ever creates one MP payment through this path.
        'X-Idempotency-Key': orderId,
      },
      body: JSON.stringify({
        transaction_amount: amountBrl,
        description: `EloBoost — Pedido #${orderId.slice(0, 8).toUpperCase()}`,
        payment_method_id: 'pix',
        payer: { email: user.email },
        date_of_expiration: expiresAt,
        external_reference: orderId,
        notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
      }),
    })

    if (!mpResp.ok) {
      console.error(`Mercado Pago create payment failed with status ${mpResp.status}`)
      // Include order_id even on failure: the order row already exists at
      // this point, so a client retry must reuse it (order_id path) instead
      // of resending an intent and creating a second order.
      return jsonResponse(req, { error: 'Falha ao criar pagamento PIX', order_id: orderId }, 502)
    }

    let mp = await mpResp.json()
    const mpPaymentId = String(mp.id)

    // MP occasionally returns the payment before the PIX QR image has
    // finished generating (point_of_interaction present but qr_code_base64
    // still null, or the whole block missing). Poll the payment a few times
    // server-side before responding, instead of pushing that wait onto the
    // client — this is the actual root cause of the "QR code sometimes
    // fails" symptom, not something a client-side retry alone can fix.
    let lastPollStatus: number | null = null
    for (let attempt = 0; attempt < 3 && !mp.point_of_interaction?.transaction_data?.qr_code_base64; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const poll = await fetchWithTimeout(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      })
      lastPollStatus = poll.status
      if (poll.ok) mp = await poll.json()
    }
    if (!mp.point_of_interaction?.transaction_data?.qr_code_base64) {
      console.error('PIX QR code still missing after polling', mpPaymentId, 'last poll status:', lastPollStatus)
    }

    const { data: recorded, error: recordError } = await serviceClient.rpc('record_pix_payment', {
      p_order_id: orderId,
      p_customer_id: user.id,
      p_mp_payment_id: mpPaymentId,
      p_amount: amountBrl,
    })
    if (recordError || !(recorded as { success?: boolean } | null)?.success) {
      console.error('Failed to persist PIX payment for order', orderId)
      return jsonResponse(req, { error: 'Falha ao registrar pagamento PIX', order_id: orderId }, 500)
    }

    return jsonResponse(req, {
      order_id: orderId,
      total_price: order.total_price,
      payment_id: mp.id,
      qr_code: mp.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: mp.point_of_interaction?.transaction_data?.qr_code_base64,
      expires_at: mp.date_of_expiration,
      reused: false,
    })
  } catch (err) {
    console.error('create-pix-payment error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
