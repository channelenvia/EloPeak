import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { getAuthUser } from '../_shared/authUser.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { classifyCardPayment, extractThreeDsInfo } from '../_shared/cardPayment.ts'

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const MP_API = 'https://api.mercadopago.com'

const MAX_INSTALLMENTS = 12
const MP_TIMEOUT_MS = 20_000
const STATEMENT_DESCRIPTOR = 'ELOPEAK'

// O pedido já existe (criado por create-pix-payment com save_only). Esta função
// só cobra o cartão: o valor vem sempre de orders.total_price, nunca do client.
const bodySchema = z.object({
  order_id: z.string().uuid(),
  // Uma chave por TENTATIVA: repetir a mesma (rede/duplo clique) devolve o mesmo
  // pagamento no MP; depois de uma recusa o client gera outra.
  idempotency_key: z.string().uuid(),
  token: z.string().min(1).max(128).regex(/^[\w-]+$/),
  payment_method_id: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/),
  issuer_id: z.union([z.string().regex(/^\d{1,12}$/), z.number().int().positive()]).optional().nullable(),
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS),
  identification: z.object({
    type: z.string().min(1).max(16).regex(/^[A-Za-z0-9_]+$/),
    number: z.string().min(1).max(32).regex(/^[\w.-]+$/),
  }).optional().nullable(),
}).strict()

type MercadoPagoPayment = {
  id: string | number
  status: string
  status_detail?: string | null
  payment_method_id?: string
  payment_type_id?: string
  transaction_amount: number
  currency_id: string
  three_ds_info?: unknown
}

const mpHeaders = { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }

async function fetchPayment(paymentId: string | number): Promise<MercadoPagoPayment | null> {
  const resp = await fetchWithTimeout(`${MP_API}/v1/payments/${paymentId}`, { headers: mpHeaders })
  return resp.ok ? await resp.json() as MercadoPagoPayment : null
}

// Cobrança criada no MP que NÃO ficou vinculada ao pedido (falha de banco ou
// corrida entre duas tentativas): desfaz para o cliente nunca pagar sem pedido.
async function reverseUnrecordedPayment(mp: MercadoPagoPayment): Promise<boolean> {
  const outcome = classifyCardPayment(mp.status)
  const resp = outcome === 'approved'
    ? await fetchWithTimeout(`${MP_API}/v1/payments/${mp.id}/refunds`, {
      method: 'POST',
      headers: { ...mpHeaders, 'X-Idempotency-Key': `reverse-${mp.id}` },
      body: '{}',
    }, MP_TIMEOUT_MS)
    : await fetchWithTimeout(`${MP_API}/v1/payments/${mp.id}`, {
      method: 'PUT',
      headers: mpHeaders,
      body: JSON.stringify({ status: 'cancelled' }),
    }, MP_TIMEOUT_MS)
  return resp.ok
}

// Confirma o pedido sem esperar o webhook. O webhook de uma aprovação
// síncrona pode chegar ANTES do registro do pagamento e ser descartado; o RPC
// é idempotente (só transiciona awaiting_payment), então repetir é seguro.
async function reconcileApprovedPayment(orderId: string, mp: MercadoPagoPayment): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc('process_mp_payment_event', {
    p_order_id: orderId,
    p_mp_payment_id: String(mp.id),
    p_provider_status: mp.status,
    p_amount: Number(mp.transaction_amount),
    p_currency: String(mp.currency_id),
    p_event_id: `card-${mp.id}-${mp.status}`,
  })
  const ok = !error && (data as { success?: boolean } | null)?.success === true
  if (!ok) console.error('Card payment approved but order reconciliation failed', orderId, String(mp.id))
  return ok
}

function paymentResult(orderId: string, mp: MercadoPagoPayment, extra: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    payment_id: mp.id,
    status: mp.status,
    status_detail: mp.status_detail ?? null,
    three_ds_info: extractThreeDsInfo(mp),
    ...extra,
  }
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405)
    if (!MP_ACCESS_TOKEN || !SUPABASE_URL) return errorResponse(req, 'Server misconfigured', 500)

    const auth = await getAuthUser(req.headers.get('Authorization'))
    if (!auth) return errorResponse(req, 'Unauthorized', 401)

    const parsedBody = bodySchema.safeParse(await readJsonBody(req))
    if (!parsedBody.success) {
      return jsonResponse(req, {
        error: 'Body inválido',
        issues: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }, 400)
    }
    const body = parsedBody.data
    const { user } = auth
    // O MP exige e-mail do pagador; sem ele devolveria um 400 genérico de "cartão".
    if (!user.email) return errorResponse(req, 'Sua conta não tem e-mail cadastrado. Use o PIX ou atualize seu e-mail.', 400, 'PAYER_EMAIL_MISSING')

    // Rate limit e leitura do pedido são independentes: uma ida ao banco só.
    const [rateLimit, { data: order, error: orderErr }] = await Promise.all([
      consumeUserRateLimit('create-card-payment', user.id, 10, 60),
      auth.client
        .from('orders')
        .select('id, customer_id, total_price, status, mp_payment_id')
        .eq('id', body.order_id)
        .single(),
    ])
    if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)
    if (orderErr || !order) return errorResponse(req, 'Order not found', 404)
    if (order.customer_id !== user.id) return errorResponse(req, 'Forbidden', 403)
    if (order.status !== 'awaiting_payment') return errorResponse(req, 'Order is not awaiting payment', 400, 'ORDER_NOT_AWAITING_PAYMENT')

    const amountBrl = Number(order.total_price)
    if (!amountBrl || amountBrl <= 0) return errorResponse(req, 'Invalid order amount', 400)

    // Um pedido aceita um único mp_payment_id. Só pagamentos aprovados/em
    // análise são vinculados (ver abaixo), então se existe um aqui nunca
    // criamos outra cobrança por cima.
    if (order.mp_payment_id) {
      const existing = await fetchPayment(order.mp_payment_id)
      if (!existing) {
        return errorResponse(req, 'Não foi possível verificar o pagamento existente. Tente novamente em instantes.', 502)
      }
      const outcome = classifyCardPayment(existing.status)
      if (existing.payment_method_id === 'pix' && outcome === 'pending') {
        return errorResponse(req, 'Este pedido já tem um PIX gerado. Pague-o ou cancele o pedido para pagar com cartão.', 409, 'PIX_PAYMENT_PENDING', { order_id: order.id })
      }
      if (outcome === 'approved') {
        // Auto-cura: aprovado no MP mas o pedido ainda não avançou.
        await reconcileApprovedPayment(order.id, existing)
        return errorResponse(req, 'Este pedido já foi pago — atualize a página.', 409, 'ALREADY_PAID', { order_id: order.id })
      }
      if (outcome === 'pending') return jsonResponse(req, paymentResult(order.id, existing, { reused: true }))
      return errorResponse(req, 'O pagamento anterior não pode mais ser reutilizado. Cancele este pedido e crie um novo.', 409, 'PAYMENT_TERMINAL', { order_id: order.id })
    }

    const mpResp = await fetchWithTimeout(`${MP_API}/v1/payments`, {
      method: 'POST',
      headers: {
        ...mpHeaders,
        'X-Idempotency-Key': `${order.id}:${body.idempotency_key}`,
      },
      body: JSON.stringify({
        transaction_amount: amountBrl,
        token: body.token,
        description: `EloPeak — Pedido #${order.id.slice(0, 8).toUpperCase()}`,
        statement_descriptor: STATEMENT_DESCRIPTOR,
        installments: body.installments,
        payment_method_id: body.payment_method_id,
        ...(body.issuer_id ? { issuer_id: Number(body.issuer_id) } : {}),
        payer: {
          email: user.email,
          ...(body.identification ? { identification: body.identification } : {}),
        },
        additional_info: {
          items: [{
            id: order.id,
            title: 'Serviço de boosting',
            quantity: 1,
            unit_price: amountBrl,
          }],
        },
        // 3DS 2.0: o banco só desafia quando acha necessário; quando autentica,
        // a responsabilidade por fraude migra para o emissor.
        three_d_secure_mode: 'optional',
        external_reference: order.id,
        notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
      }),
    }, MP_TIMEOUT_MS)

    if (!mpResp.ok) {
      // 4xx do MP aqui costuma ser dado de cartão/token inválido -- não vaza o corpo.
      console.error(`Mercado Pago card payment failed with status ${mpResp.status}`)
      const isClientError = mpResp.status >= 400 && mpResp.status < 500
      return errorResponse(
        req,
        isClientError ? 'Não foi possível processar o cartão. Confira os dados e tente novamente.' : 'Falha ao processar o pagamento. Tente novamente em instantes.',
        isClientError ? 422 : 502,
        'CARD_PAYMENT_FAILED',
        { order_id: order.id },
      )
    }

    const mp = await mpResp.json() as MercadoPagoPayment
    const outcome = classifyCardPayment(mp.status)

    // Recusado: não vincula ao pedido, que continua livre para outro cartão. O
    // webhook desse pagamento cai em "payment_order_mismatch" e é ignorado.
    if (outcome === 'rejected') return jsonResponse(req, paymentResult(order.id, mp))

    const { data: recorded, error: recordError } = await supabaseAdmin().rpc('record_card_payment', {
      p_order_id: order.id,
      p_customer_id: user.id,
      p_mp_payment_id: String(mp.id),
      p_amount: amountBrl,
      p_method_type: mp.payment_type_id === 'debit_card' ? 'debit_card' : 'credit_card',
    })
    if (recordError || !(recorded as { success?: boolean } | null)?.success) {
      // Não vinculou (falha de banco ou outra tentativa concorrente já ganhou o
      // pedido): desfaz a cobrança para ninguém pagar sem pedido.
      console.error('Failed to persist card payment for order', order.id, String(mp.id))
      const reversed = await reverseUnrecordedPayment(mp).catch(() => false)
      if (!reversed) console.error('CRITICAL: card payment charged but unrecorded and NOT reversed', order.id, String(mp.id))
      return errorResponse(
        req,
        reversed
          ? 'Não foi possível concluir o pagamento. A cobrança foi desfeita; tente novamente.'
          : 'Falha ao registrar o pagamento. Tente novamente — você não será cobrado duas vezes.',
        reversed ? 409 : 500,
        reversed ? 'PAYMENT_REVERSED' : 'PAYMENT_RECORD_FAILED',
        { order_id: order.id },
      )
    }

    if (outcome === 'approved') await reconcileApprovedPayment(order.id, mp)
    return jsonResponse(req, paymentResult(order.id, mp))
  } catch (err) {
    console.error('create-card-payment error', err instanceof Error ? err.name : 'unknown')
    if (err instanceof HttpError) return errorResponse(req, err.message, err.status)
    return errorResponse(req, 'Internal server error', 500)
  }
})
