import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'
import { APP_URL, notifyAdmins } from '../_shared/discordJobAnnounce.ts'

const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''

const payloadSchema = z.object({
  booster_id: z.string().uuid(),
  display_name: z.string().optional(),
})

// DM pra todo admin com Discord vinculado quando um candidato a booster
// entra em 'pending' (novo cadastro) -- disparada inline por onboard_booster
// (migration 20260908020000), mesmo padrão de net.http_post e mesmo secret
// (DISCORD_WEBHOOK_SECRET) usados por discord-admin-review-alert.
serve(async (req) => {
  if (!Deno.env.get('DISCORD_BOT_TOKEN')) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const auth = await verifyWebhookRequest(req, { scope: 'discord-admin-booster-alert', webhookSecret: WEBHOOK_SECRET })
  if (!auth.ok) return auth.response

  const parsed = payloadSchema.safeParse(auth.rawBody)
  if (!parsed.success) {
    return jsonResponse(req, { error: 'invalid webhook payload' }, 400)
  }
  const { booster_id: boosterId, display_name: displayName } = parsed.data

  try {
    const dm = {
      embeds: [{
        title: '🆕 Novo booster pendente',
        url: `${APP_URL}/admin/boosters/${boosterId}`,
        description: `${displayName ?? 'Um candidato'} se candidatou como booster e está aguardando aprovação.`,
        color: 0xF59E0B,
        footer: eloPeakFooter(APP_URL),
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: 'Ver candidatura', url: `${APP_URL}/admin/boosters/${boosterId}` }],
      }],
    }

    let sent: number
    try {
      sent = await notifyAdmins(dm, 'discord-admin-booster-alert')
    } catch (err) {
      console.error('discord-admin-booster-alert: admin lookup failed', err instanceof Error ? err.message : err)
      return jsonResponse(req, { error: 'admin_lookup_failed' }, 500)
    }

    return jsonResponse(req, { ok: true, sent })
  } catch (err) {
    console.error('discord-admin-booster-alert error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
