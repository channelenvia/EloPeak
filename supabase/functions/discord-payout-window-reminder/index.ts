import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse, rateLimitResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { APP_URL, sendDirectMessage } from '../_shared/discordJobAnnounce.ts'
import { eloPeakFooter } from '../_shared/discordRankFormat.ts'

// Chamada só pelo Cron Job do Supabase, dias 15 e 30 (mesmo padrão de
// discord-top3-announcement/announce-expired-exclusive-jobs) -- secret
// próprio, nunca por um usuário logado.
const CRON_SECRET = Deno.env.get('DISCORD_PAYOUT_REMINDER_CRON_SECRET') ?? ''

const currency = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

function buildReminderDm(availableBalance: number) {
  return {
    embeds: [{
      title: '💰 Janela de saque aberta hoje',
      url: `${APP_URL}/booster/payments`,
      description: `Hoje é dia de saque -- você pode solicitar o pagamento do seu saldo disponível de ${currency(availableBalance)}.`,
      color: 0x22C55E,
      footer: eloPeakFooter(APP_URL),
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Solicitar saque', url: `${APP_URL}/booster/payments` }],
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

  const rateLimit = await consumeUserRateLimit('discord-payout-window-reminder', 'cron', 2, 300)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  const db = supabaseAdmin()
  let notified = 0
  const failures: string[] = []

  try {
    const { data: targets, error } = await db.rpc('list_payout_reminder_targets')
    if (error) throw new Error(`Failed to load payout reminder targets: ${error.message}`)

    for (const target of (targets ?? []) as { booster_id: string; discord_id: string; available_balance: number }[]) {
      try {
        await sendDirectMessage(target.discord_id, buildReminderDm(target.available_balance))

        const { error: notifyError } = await db.from('notifications').insert({
          user_id: target.booster_id,
          type: 'payout_window_open',
          title: 'Janela de saque aberta',
          body: `Você tem ${currency(target.available_balance)} disponível -- a janela de saque está aberta hoje.`,
          data: { available_balance: target.available_balance },
        })
        if (notifyError) throw new Error(notifyError.message)

        notified += 1
      } catch (err) {
        console.error('discord-payout-window-reminder: failed for booster', target.booster_id, err)
        failures.push(target.booster_id)
      }
    }

    return jsonResponse(req, { ok: true, notified, checked: (targets ?? []).length, failures })
  } catch (err) {
    console.error('discord-payout-window-reminder error:', err)
    return jsonResponse(req, { error: 'discord_payout_window_reminder_error' }, 500)
  }
})
