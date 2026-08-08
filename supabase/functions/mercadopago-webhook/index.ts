import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { createHmac } from 'node:crypto'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit, getClientIp } from '../_shared/rateLimit.ts'

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') ?? ''
const MP_WEBHOOK_SECRET = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET') ?? ''

const webhookBodySchema = z.object({
  type: z.string().optional(),
  data: z.object({
    id: z.union([z.string(), z.number()]).optional(),
  }).passthrough().optional(),
}).passthrough()

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
  const parts = Object.fromEntries(xSignature.split(',').map((part) => {
    const [key, value] = part.split('=', 2)
    return [key?.trim(), value?.trim()]
  }))
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  const timestamp = Number(ts)
  if (!Number.isFinite(timestamp)) return false
  const timestampMs = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const ageMs = Date.now() - timestampMs
  if (ageMs < -60_000 || ageMs > 10 * 60_000) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex')

  return constantTimeEqual(expected, v1)
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

const paymentSchema = z.object({
  id: z.union([z.string(), z.number()]),
  external_reference: z.string().uuid(),
  status: z.string().min(1),
  currency_id: z.string().min(1),
  transaction_amount: z.number().positive().finite(),
  refunds: z.array(z.object({ id: z.union([z.string(), z.number()]) }).passthrough()).optional(),
}).passthrough()

serve(async (req) => {
  // MP sends POST; return 200 fast to avoid retries on our end
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  if (!MP_ACCESS_TOKEN) {
    console.error('MERCADOPAGO_ACCESS_TOKEN is not set')
    return new Response('server misconfigured', { status: 500 })
  }

  try {
    // Public, unauthenticated endpoint — throttle by IP before doing any
    // JSON parsing or signature work, so volumetric flooding is cheap to
    // reject. Limit is generous relative to normal MP notification volume.
    // Ver getClientIp em _shared/rateLimit.ts pra ordem de preferência de
    // headers (antes disso, este arquivo usava o PRIMEIRO valor de
    // x-forwarded-for, que é livremente forjável pelo próprio cliente).
    const clientIp = getClientIp(req)
    const rateLimit = await consumeUserRateLimit('mercadopago-webhook', clientIp, 120, 60)
    if (!rateLimit.allowed) return new Response('too many requests', { status: 429 })

    const rawBody = await readJsonBody(req, 16 * 1024)

    const parsedBody = webhookBodySchema.safeParse(rawBody)
    if (!parsedBody.success) return new Response('invalid payload', { status: 400 })
    const body = parsedBody.data

  // We only handle payment notifications
    if (body.type !== 'payment' || !body.data) return new Response('ok', { status: 200 })

    const urlDataId = new URL(req.url).searchParams.get('data.id')
    const dataId = String(urlDataId ?? body.data.id ?? '').toLowerCase()
    if (!dataId) return new Response('ok', { status: 200 })

  // Verify webhook authenticity — fail closed in all environments.
  // Dev bypass only when DENO_ENV=development AND secret is explicitly absent.
    const isDev = Deno.env.get('DENO_ENV') === 'development'
    if (!MP_WEBHOOK_SECRET) {
      if (!isDev) {
      console.error('MERCADOPAGO_WEBHOOK_SECRET is not set — rejecting all webhook traffic')
      return new Response('server misconfigured', { status: 500 })
      }
    } else {
      const xSignature = req.headers.get('x-signature')
      const xRequestId = req.headers.get('x-request-id')
      if (!verifySignature(xSignature, xRequestId, dataId)) {
        console.error('Invalid MP webhook signature')
        return new Response('invalid signature', { status: 401 })
      }
    }

    const supabase = supabaseAdmin()

  // Always re-fetch the payment from MP API — never trust webhook body data directly
    const mpResp = await fetchWithTimeout(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    })

  if (!mpResp.ok) {
    console.error('Failed to fetch MP payment:', dataId)
    return new Response('upstream error', { status: 502 })
  }

    const parsedPayment = paymentSchema.safeParse(await mpResp.json())
    if (!parsedPayment.success) return new Response('invalid provider response', { status: 502 })
    const payment = parsedPayment.data
    const mpStatus = payment.status
    if (!(mpStatus in STATUS_MAP)) return new Response('ok', { status: 200 })

    const requestId = req.headers.get('x-request-id') ?? `mp-${dataId}-${mpStatus}`
    const { data: processed, error } = await supabase.rpc('process_mp_payment_event', {
      p_order_id: payment.external_reference,
      p_mp_payment_id: String(payment.id),
      p_provider_status: mpStatus,
      p_amount: payment.transaction_amount,
      p_currency: payment.currency_id,
      p_event_id: requestId,
      p_refund_id: payment.refunds?.[0]?.id != null ? String(payment.refunds[0].id) : undefined,
    })
    const result = processed as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      if (result?.error === 'payment_order_mismatch' || result?.error === 'payment_not_found') {
        console.warn('MP webhook for missing local pending order/payment', result.error)
        return new Response('ok', { status: 200 })
      }
      console.error('MP webhook reconciliation failed', result?.error ?? 'database error')
      return new Response('reconciliation failed', { status: 409 })
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status })
    console.error('mercadopago-webhook error')
    return new Response('internal error', { status: 500 })
  }
})
