import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'

const DISCORD_API   = 'https://discord.com/api/v10'
const BOT_TOKEN      = Deno.env.get('DISCORD_BOT_TOKEN')      ?? ''
const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app').replace(/\/$/, '')

const payloadSchema = z.object({
  user_id: z.string().uuid(),
  order_id: z.string().uuid(),
  body: z.string().min(1),
})

// Mesmas 3 rotas de detalhe do pedido usadas em src/app/router.tsx -- o link
// certo depende de qual papel o usuário mencionado tem NESSE pedido
// específico (um admin pode ser cliente de outro pedido, por exemplo).
function orderDetailUrl(order: { id: string; customer_id: string; assigned_booster_id: string | null }, mentionedUserId: string) {
  if (order.customer_id === mentionedUserId) return `${APP_URL}/orders/${order.id}`
  if (order.assigned_booster_id === mentionedUserId) return `${APP_URL}/booster/orders/${order.id}`
  return `${APP_URL}/admin/orders/${order.id}`
}

serve(async (req) => {
  if (!BOT_TOKEN) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const auth = await verifyWebhookRequest(req, { scope: 'discord-chat-mention', webhookSecret: WEBHOOK_SECRET })
  if (!auth.ok) return auth.response

  const parsed = payloadSchema.safeParse(auth.rawBody)
  if (!parsed.success) {
    return jsonResponse(req, { error: 'invalid webhook payload' }, 400)
  }
  const { user_id: userId, order_id: orderId, body } = parsed.data

  try {
    const db = supabaseAdmin()

    const [{ data: profile }, { data: order }] = await Promise.all([
      db.from('profiles').select('discord_id').eq('id', userId).single(),
      db.from('orders').select('id, customer_id, assigned_booster_id').eq('id', orderId).single(),
    ])

    // Nem todo usuário tem Discord vinculado -- sem discord_id não tem pra
    // onde mandar o DM, não é um erro, só não se aplica.
    if (!profile?.discord_id) {
      return jsonResponse(req, { ok: true, action: 'skipped_no_discord_id' })
    }
    if (!order) {
      return jsonResponse(req, { ok: false, reason: 'order not found' })
    }

    const shortCode = orderId.slice(0, 8).toUpperCase()

    // Discord exige abrir (ou reaproveitar) o canal de DM antes de mandar
    // qualquer mensagem direta -- idempotente, sempre retorna o mesmo
    // channel id pra um par bot/usuário, mesmo que já exista uma DM aberta.
    const dmRes = await fetchWithTimeout(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: profile.discord_id }),
    })
    if (!dmRes.ok) {
      console.error(`Discord create DM channel failed ${dmRes.status}:`, await dmRes.text())
      return jsonResponse(req, { error: 'discord_dm_channel_error' }, 502)
    }
    const dmChannel = await dmRes.json() as { id: string }

    const msgRes = await fetchWithTimeout(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '💬 Você foi mencionado',
          url: orderDetailUrl(order, userId),
          description: body,
          color: 0x5865F2,
          fields: [{ name: 'Pedido', value: `#${shortCode}`, inline: true }],
          footer: eloPeakFooter(APP_URL),
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: 'Ver Pedido', url: orderDetailUrl(order, userId) }],
        }],
      }),
    })
    if (!msgRes.ok) {
      console.error(`Discord send DM failed ${msgRes.status}:`, await msgRes.text())
      return jsonResponse(req, { error: 'discord_dm_send_error' }, 502)
    }

    return jsonResponse(req, { ok: true, action: 'dm_sent' })
  } catch (err) {
    console.error('discord-chat-mention error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
