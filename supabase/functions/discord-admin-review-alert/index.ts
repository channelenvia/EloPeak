import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'
import { APP_URL, sendDirectMessage } from '../_shared/discordJobAnnounce.ts'

const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''

const payloadSchema = z.object({
  order_id: z.string().uuid(),
})

// DM pra todo admin com Discord vinculado quando um pedido pago entra na
// janela de revisão (pending_review) -- disparada inline por
// process_mp_payment_event/release_paid_order_after_credentials (migration
// 20260906190000), mesmo padrão de net.http_post usado por
// admin_reassign_booster. Reusa DISCORD_WEBHOOK_SECRET (mesmo secret de
// discord-order-channel/discord-chat-mention) -- não é uma ação por usuário
// específico como aquelas, mas o gate é o mesmo (chamada só vem de dentro do
// banco, nunca de um cliente logado).
serve(async (req) => {
  if (!Deno.env.get('DISCORD_BOT_TOKEN')) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const auth = await verifyWebhookRequest(req, { scope: 'discord-admin-review-alert', webhookSecret: WEBHOOK_SECRET })
  if (!auth.ok) return auth.response

  const parsed = payloadSchema.safeParse(auth.rawBody)
  if (!parsed.success) {
    return jsonResponse(req, { error: 'invalid webhook payload' }, 400)
  }
  const { order_id: orderId } = parsed.data

  try {
    const db = supabaseAdmin()
    const { data: admins, error } = await db.from('profiles').select('discord_id').eq('role', 'admin').not('discord_id', 'is', null)
    if (error) {
      console.error('discord-admin-review-alert: admin lookup failed', error.message)
      return jsonResponse(req, { error: 'admin_lookup_failed' }, 500)
    }

    const shortCode = orderId.slice(0, 8).toUpperCase()
    const dm = {
      embeds: [{
        title: '🆕 Pedido pago -- em revisão',
        url: `${APP_URL}/admin/orders/${orderId}`,
        description: `Pedido #${shortCode} está na janela de revisão. Disponibilize, analise, atribua ou cancele.`,
        color: 0xF59E0B,
        footer: eloPeakFooter(APP_URL),
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: 'Ver pedido', url: `${APP_URL}/admin/orders/${orderId}` }],
      }],
    }

    let sent = 0
    for (const admin of (admins ?? []) as { discord_id: string | null }[]) {
      if (!admin.discord_id) continue
      try {
        await sendDirectMessage(admin.discord_id, dm)
        sent += 1
      } catch (err) {
        console.error('discord-admin-review-alert: failed to DM admin', err instanceof Error ? err.message : err)
      }
    }

    return jsonResponse(req, { ok: true, sent })
  } catch (err) {
    console.error('discord-admin-review-alert error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
