import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { eloPeakFooter, escapeDiscordMarkdown } from '../_shared/discordRankFormat.ts'
import { BOT_TOKEN, APP_URL, sendDirectMessage } from '../_shared/discordJobAnnounce.ts'

const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''

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

    const [{ data: profile, error: profileError }, { data: order, error: orderError }] = await Promise.all([
      db.from('profiles').select('discord_id').eq('id', userId).single(),
      db.from('orders').select('id, customer_id, assigned_booster_id').eq('id', orderId).single(),
    ])
    // Uma falha real de banco/rede aqui não pode virar silenciosamente
    // "usuário sem discord_id" ou "pedido não encontrado" -- sem logar, um
    // erro transiente vira invisível.
    if (profileError) console.error('discord-chat-mention: profile lookup failed', profileError.message)
    if (orderError) console.error('discord-chat-mention: order lookup failed', orderError.message)

    // Nem todo usuário tem Discord vinculado -- sem discord_id não tem pra
    // onde mandar o DM, não é um erro, só não se aplica.
    if (!profile?.discord_id) {
      return jsonResponse(req, { ok: true, action: 'skipped_no_discord_id' })
    }
    if (!order) {
      return jsonResponse(req, { ok: false, reason: 'order not found' })
    }
    // O payload vem autenticado só por segredo compartilhado (webhookAuth),
    // não por sessão do usuário -- sem esta checagem, qualquer chamador com
    // o segredo podia mandar DM (com texto/link arbitrário) pra um usuário
    // Discord vinculado alegando falsamente uma menção num pedido que ele
    // não participa. discord-order-channel já faz o equivalente re-checando
    // o payload contra o banco; aqui replicamos pro mencionado.
    if (order.customer_id !== userId && order.assigned_booster_id !== userId) {
      return jsonResponse(req, { ok: false, reason: 'user is not a participant of this order' })
    }

    const shortCode = orderId.slice(0, 8).toUpperCase()

    try {
      await sendDirectMessage(profile.discord_id, {
        embeds: [{
          title: '💬 Você foi mencionado',
          url: orderDetailUrl(order, userId),
          description: escapeDiscordMarkdown(body),
          color: 0x5865F2,
          fields: [{ name: 'Pedido', value: `#${shortCode}`, inline: true }],
          footer: eloPeakFooter(APP_URL),
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: 'Ver Pedido', url: orderDetailUrl(order, userId) }],
        }],
      })
    } catch (dmErr) {
      console.error('discord-chat-mention: failed to send DM', dmErr instanceof Error ? dmErr.message : dmErr)
      return jsonResponse(req, { error: 'discord_dm_send_error' }, 502)
    }

    return jsonResponse(req, { ok: true, action: 'dm_sent' })
  } catch (err) {
    console.error('discord-chat-mention error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
