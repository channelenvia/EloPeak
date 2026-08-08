import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'

const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
// Secret dedicado pra esse endpoint só ser chamável pelo cron interno
// (pg_cron -> pg_net), nunca por qualquer request externa -- mesmo padrão
// x-webhook-secret já usado em discord-order-channel/discord-init-channels,
// só que com um secret PRÓPRIO em vez de reaproveitar o deles (o cron não
// tem acesso ao valor configurado lá, e não devia -- superfícies de auth
// separadas por integração).
const CRON_SECRET = Deno.env.get('DISCORD_CRON_SECRET') ?? ''
// IDs de canal não são credenciais -- não precisam de secret/env, só o
// bot precisa ter sido convidado com permissão de enviar mensagem neles.
const CHANNEL_TOP3 = '1531134555015086293'

interface TopBoosterRow {
  booster_id: string
  display_name: string
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!CRON_SECRET || !BOT_TOKEN) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const db = supabaseAdmin()

    // Recalcula o ranking antes de anunciar -- sem isso, o cron podia
    // anunciar com base num score de dias atrás em vez do estado atual.
    const { error: refreshError } = await db.rpc('refresh_top3_boosters')
    if (refreshError) {
      console.error('refresh_top3_boosters failed', refreshError.message)
      return jsonResponse(req, { error: 'refresh_failed' }, 500)
    }

    const { data: result, error: topError } = await db.rpc('get_top_boosters', {
      p_service_type: '__all__',
      p_rank_bucket: '__all__',
      p_limit: 3,
    })
    if (topError) {
      console.error('get_top_boosters failed', topError.message)
      return jsonResponse(req, { error: 'get_top_boosters_failed' }, 500)
    }

    const boosters = ((result as { boosters?: TopBoosterRow[] } | null)?.boosters ?? [])
    if (boosters.length === 0) {
      return jsonResponse(req, { ok: true, action: 'skipped_no_boosters' })
    }

    const { data: profiles } = await db
      .from('profiles')
      .select('id, discord_id')
      .in('id', boosters.map((b) => b.booster_id))
    const discordIdByBoosterId = new Map(
      (profiles ?? []).map((p) => [p.id as string, p.discord_id as string | null]),
    )

    const medals = ['🥇', '🥈', '🥉']
    const lines = boosters.map((b, i) => {
      const discordId = discordIdByBoosterId.get(b.booster_id)
      const mention = discordId ? `<@${discordId}>` : `**${b.display_name}**`
      return `${medals[i] ?? '🏅'} Top ${i + 1} — ${mention}`
    })

    const discordRes = await fetchWithTimeout(`${DISCORD_API}/channels/${CHANNEL_TOP3}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: lines.join('\n'),
        embeds: [{
          title: '🏆 Top 3 Boosters atualizado!',
          description: 'Ranking recalculado automaticamente com base em win rate, KDA e avaliações reais.',
          color: 0xFACC15,
        }],
        allowed_mentions: { parse: ['users'] },
      }),
    })

    if (!discordRes.ok) {
      console.error('Discord send message failed', discordRes.status, await discordRes.text())
      return jsonResponse(req, { error: 'discord_send_failed' }, 502)
    }

    return jsonResponse(req, { ok: true, action: 'announced', count: boosters.length })
  } catch (err) {
    console.error('discord-top3-announcement error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
