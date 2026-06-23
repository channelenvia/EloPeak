import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHmac } from 'node:crypto'

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') ?? ''
const MP_WEBHOOK_SECRET = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Verify Mercado Pago webhook signature (v2 format)
// Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
function verifySignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
): boolean {
  // Secret is mandatory — if missing the function is misconfigured, not in dev mode
  if (!MP_WEBHOOK_SECRET) return false
  if (!xSignature || !xRequestId) return false

  // Parse ts and v1 from "ts=<timestamp>,v1=<hmac>"
  const parts = Object.fromEntries(xSignature.split(',').map((p) => p.split('=')))
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex')

  return expected === v1
}

// Map MP statuses to our internal payment_status enum
const STATUS_MAP: Record<string, string> = {
  approved: 'paid',
  pending: 'pending',
  in_process: 'pending',
  authorized: 'pending',
  rejected: 'failed',
  cancelled: 'failed',
  refunded: 'refunded',
  charged_back: 'disputed',
}

serve(async (req) => {
  // MP sends POST; return 200 fast to avoid retries on our end
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  // We only handle payment notifications
  if (body.type !== 'payment' || !body.data) {
    return new Response('ok', { status: 200 })
  }

  const dataId = String((body.data as Record<string, unknown>).id ?? '')
  if (!dataId) return new Response('ok', { status: 200 })

  // Verify webhook authenticity — fail closed in all environments.
  // Dev bypass only when DENO_ENV=development AND secret is explicitly absent.
  const isDev = Deno.env.get('DENO_ENV') === 'development'
  if (!MP_WEBHOOK_SECRET) {
    if (isDev) {
      console.warn('[DEV] MERCADOPAGO_WEBHOOK_SECRET not set — skipping signature check in development only')
    } else {
      console.error('MERCADOPAGO_WEBHOOK_SECRET is not set — rejecting all webhook traffic')
      return new Response('server misconfigured', { status: 500 })
    }
  } else {
    const xSignature = req.headers.get('x-signature')
    const xRequestId = req.headers.get('x-request-id')
    if (!verifySignature(xSignature, xRequestId, dataId)) {
      console.error('Invalid MP webhook signature for payment', dataId)
      return new Response('invalid signature', { status: 401 })
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Idempotency: skip events we already processed
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('webhook_event_id', `mp-${dataId}`)
    .maybeSingle()

  if (existing) {
    console.log('Duplicate MP webhook event — skipping:', dataId)
    return new Response('ok', { status: 200 })
  }

  // Always re-fetch the payment from MP API — never trust webhook body data directly
  const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  })

  if (!mpResp.ok) {
    console.error('Failed to fetch MP payment:', dataId)
    return new Response('upstream error', { status: 502 })
  }

  const payment = await mpResp.json()
  const orderId: string = payment.external_reference
  const mpStatus: string = payment.status
  const mpPaymentId = String(payment.id)

  if (!orderId) {
    console.error('MP payment has no external_reference:', mpPaymentId)
    return new Response('ok', { status: 200 })
  }

  const paymentStatus = STATUS_MAP[mpStatus] ?? 'pending'

  // Update payment record
  await supabase
    .from('payments')
    .update({
      status: paymentStatus,
      webhook_event_id: `mp-${dataId}`,
      updated_at: new Date().toISOString(),
    })
    .eq('mp_payment_id', mpPaymentId)

  if (mpStatus === 'approved') {
    // Fetch order — must include total_price for amount reconciliation
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, customer_id, total_price')
      .eq('id', orderId)
      .single()

    if (order && order.status === 'awaiting_payment') {
      // Guard: reject if currency is not BRL
      if (payment.currency_id !== 'BRL') {
        console.error('MP webhook: unexpected currency', payment.currency_id, 'for order', orderId)
        return new Response('currency mismatch', { status: 400 })
      }

      // Guard: reject if amount paid is less than what the order requires
      const paidAmount = Number(payment.transaction_amount)
      const expectedAmount = Number(order.total_price)
      if (paidAmount < expectedAmount) {
        console.error('MP webhook: amount mismatch — paid', paidAmount, 'expected', expectedAmount, 'for order', orderId)
        return new Response('amount mismatch', { status: 400 })
      }

      await Promise.all([
        supabase.from('orders').update({
          status: 'awaiting_assignment',
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        }).eq('id', orderId),

        supabase.from('order_status_history').insert({
          order_id: orderId,
          from_status: 'awaiting_payment',
          to_status: 'awaiting_assignment',
          changed_by: order.customer_id,
          reason: 'Pagamento PIX confirmado via Mercado Pago',
        }),

        supabase.from('notifications').insert({
          user_id: order.customer_id,
          type: 'payment_confirmed',
          title: 'PIX confirmado!',
          body: `Seu pedido #${orderId.slice(0, 8).toUpperCase()} foi pago e está na fila de boosters.`,
          data: { order_id: orderId },
        }),
      ])
    }
  }

  if (mpStatus === 'refunded') {
    await supabase
      .from('orders')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', orderId)
  }

  if (mpStatus === 'charged_back') {
    await supabase
      .from('orders')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', orderId)
  }

  return new Response('ok', { status: 200 })
})
