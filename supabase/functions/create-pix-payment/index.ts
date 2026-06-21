import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    // Authenticate caller
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { order_id } = await req.json()
    if (!order_id) return json({ error: 'Missing order_id' }, 400)

    // Verify order ownership and status
    const { data: order, error: orderErr } = await userClient
      .from('orders')
      .select('id, customer_id, total_price, status, mp_payment_id')
      .eq('id', order_id)
      .single()

    if (orderErr || !order) return json({ error: 'Order not found' }, 404)
    if (order.customer_id !== user.id) return json({ error: 'Forbidden' }, 403)
    if (order.status !== 'awaiting_payment') return json({ error: 'Order is not awaiting payment' }, 400)

    // Amount is always derived from the DB — never from the client request
    if (!order.total_price || Number(order.total_price) <= 0) {
      return json({ error: 'Invalid order amount' }, 400)
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // If there is already a pending MP payment for this order, try to reuse it
    if (order.mp_payment_id) {
      const existing = await fetch(
        `https://api.mercadopago.com/v1/payments/${order.mp_payment_id}`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } },
      )
      if (existing.ok) {
        const mp = await existing.json()
        // pending or in_process: return the existing QR code
        if (mp.status === 'pending' || mp.status === 'in_process') {
          return json({
            payment_id: mp.id,
            qr_code: mp.point_of_interaction?.transaction_data?.qr_code,
            qr_code_base64: mp.point_of_interaction?.transaction_data?.qr_code_base64,
            expires_at: mp.date_of_expiration,
            reused: true,
          })
        }
      }
    }

    // Create new PIX payment via Mercado Pago API
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    // Amount sourced exclusively from DB — client cannot influence this value
    const amountBrl = Number(order.total_price)

    const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Idempotency key prevents duplicate charges if the client retries
        'X-Idempotency-Key': `${order_id}-${Math.floor(Date.now() / (30 * 60 * 1000))}`,
      },
      body: JSON.stringify({
        transaction_amount: amountBrl,
        description: `EloBoost — Pedido #${order_id.slice(0, 8).toUpperCase()}`,
        payment_method_id: 'pix',
        payer: { email: user.email },
        date_of_expiration: expiresAt,
        external_reference: order_id,
        notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
      }),
    })

    if (!mpResp.ok) {
      const err = await mpResp.json()
      console.error('Mercado Pago error:', err)
      return json({ error: 'Falha ao criar pagamento PIX', details: err }, 502)
    }

    const mp = await mpResp.json()
    const mpPaymentId = String(mp.id)

    // Persist MP payment ID on the order and create the payment record
    await Promise.all([
      serviceClient
        .from('orders')
        .update({ mp_payment_id: mpPaymentId, updated_at: new Date().toISOString() })
        .eq('id', order_id),

      serviceClient.from('payments').upsert(
        {
          order_id,
          customer_id: user.id,
          mp_payment_id: mpPaymentId,
          amount: amountBrl,
          currency: 'brl',
          status: 'pending',
          metadata: { provider: 'mercadopago', mp_payment_id: mpPaymentId },
        },
        { onConflict: 'order_id' },
      ),
    ])

    return json({
      payment_id: mp.id,
      qr_code: mp.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: mp.point_of_interaction?.transaction_data?.qr_code_base64,
      expires_at: mp.date_of_expiration,
      reused: false,
    })
  } catch (err) {
    console.error('create-pix-payment error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
