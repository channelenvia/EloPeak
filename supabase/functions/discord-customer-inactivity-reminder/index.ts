import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { APP_URL, sendDirectMessage } from '../_shared/discordJobAnnounce.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'

// Chamada diariamente pelo Cron Job do Supabase -- secret próprio, nunca por
// um usuário logado. list_customer_inactivity_reminder_targets já filtra
// quem repete o lembrete a cada 15 dias (profiles.last_inactivity_dm_sent_at).
const CRON_SECRET = Deno.env.get('DISCORD_INACTIVITY_REMINDER_CRON_SECRET') ?? ''

function buildReminderDm() {
  return {
    embeds: [{
      title: '👋 Sentimos sua falta!',
      url: `${APP_URL}/orders/new`,
      description: 'Faz um tempo que você não faz um pedido na EloPeak. Que tal dar uma olhada nos nossos serviços?',
      color: 0x5865F2,
      footer: eloPeakFooter(APP_URL),
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Fazer um pedido', url: `${APP_URL}/orders/new` }],
    }],
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!CRON_SECRET) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await consumeUserRateLimit('discord-customer-inactivity-reminder', 'cron', 2, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  const db = supabaseAdmin()
  let notified = 0
  const sentTo: string[] = []
  const failures: string[] = []

  try {
    const { data: targets, error } = await db.rpc('list_customer_inactivity_reminder_targets')
    if (error) throw new Error(`Failed to load inactivity reminder targets: ${error.message}`)

    for (const target of (targets ?? []) as { customer_id: string; discord_id: string; last_order_at: string }[]) {
      try {
        await sendDirectMessage(target.discord_id, buildReminderDm())

        const { error: notifyError } = await db.from('notifications').insert({
          user_id: target.customer_id,
          type: 'customer_inactivity_reminder',
          title: 'Sentimos sua falta!',
          body: 'Faz um tempo que você não faz um pedido na EloPeak. Que tal dar uma olhada nos nossos serviços?',
          data: { last_order_at: target.last_order_at },
        })
        if (notifyError) throw new Error(notifyError.message)

        notified += 1
        sentTo.push(target.customer_id)
      } catch (err) {
        console.error('discord-customer-inactivity-reminder: failed for customer', target.customer_id, err)
        failures.push(target.customer_id)
      }
    }

    // Só marca quem realmente recebeu o DM+notificação com sucesso -- quem
    // falhou (Discord fora do ar etc.) continua elegível na próxima rodada
    // do cron em vez de esperar mais 15 dias por um lembrete que não chegou.
    if (sentTo.length > 0) {
      const { error: markError } = await db.rpc('mark_customer_inactivity_reminder_sent', { p_customer_ids: sentTo })
      if (markError) console.error('discord-customer-inactivity-reminder: failed to mark sent', markError.message)
    }

    return jsonResponse(req, { ok: true, notified, checked: (targets ?? []).length, failures })
  } catch (err) {
    console.error('discord-customer-inactivity-reminder error:', err)
    return jsonResponse(req, { error: 'discord_customer_inactivity_reminder_error' }, 500)
  }
})
