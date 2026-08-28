import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { coreServiceFields, rankIconTier, cardThumbnailUrl, eloPeakFooter, escapeDiscordMarkdown } from '../_shared/discordRankFormat.ts'

const DISCORD_API   = 'https://discord.com/api/v10'
const BOT_TOKEN      = Deno.env.get('DISCORD_BOT_TOKEN')      ?? ''
const WEBHOOK_SECRET = Deno.env.get('DISCORD_WEBHOOK_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app').replace(/\/$/, '')
// ID de canal não é credencial -- mesmo padrão de CHANNEL_TOP3 em
// discord-top3-announcement, só o bot precisa ter permissão de enviar
// mensagem lá.
const CHANNEL_REVIEWS = '1515456626688266240'

const payloadSchema = z.object({
  review_id: z.string().uuid(),
})

function starBar(rating: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)))
  return '⭐'.repeat(clamped) + '☆'.repeat(5 - clamped)
}

serve(async (req) => {
  if (!BOT_TOKEN) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const auth = await verifyWebhookRequest(req, { scope: 'discord-review-announcement', webhookSecret: WEBHOOK_SECRET })
  if (!auth.ok) return auth.response

  const parsed = payloadSchema.safeParse(auth.rawBody)
  if (!parsed.success) {
    return jsonResponse(req, { error: 'invalid webhook payload' }, 400)
  }
  const { review_id: reviewId } = parsed.data

  try {
    const db = supabaseAdmin()

    const { data: review } = await db
      .from('reviews')
      .select('id, order_id, customer_id, booster_id, rating, content, created_at')
      .eq('id', reviewId)
      .maybeSingle()
    if (!review) {
      return jsonResponse(req, { ok: false, reason: 'review not found' })
    }

    const [{ data: customerProfile }, { data: boosterProfile }, { data: boosterRow }, { data: orderRow }] = await Promise.all([
      db.from('profiles').select('username, discord_id').eq('id', review.customer_id).maybeSingle(),
      review.booster_id
        ? db.from('profiles').select('discord_id').eq('id', review.booster_id).maybeSingle()
        : Promise.resolve({ data: null }),
      review.booster_id
        ? db.from('booster_profiles').select('display_name').eq('user_id', review.booster_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('orders')
        .select('service_type, boost_mode, queue_type, current_rank, target_rank, clash_tier, clash_day, wins_purchased, sessions_purchased, booster_service_id')
        .eq('id', review.order_id)
        .maybeSingle(),
    ])

    // coach_package_title só existe pra coaching (booster_service_id sempre
    // null nos outros service_types) -- mesmo padrão de fetchOrderProfiles
    // em discord-order-channel, serviceDetail() (dentro de coreServiceFields)
    // precisa dele pro campo "🎓 Pacote".
    const { data: coachPackage } = orderRow?.booster_service_id
      ? await db.from('booster_services').select('title').eq('id', orderRow.booster_service_id).maybeSingle()
      : { data: null as { title: string } | null }
    const order = orderRow ? { ...orderRow, coach_package_title: coachPackage?.title ?? null } : null

    // Cliente nunca é @mencionado (marcado) na review -- só o booster, que é
    // quem a mensagem existe pra divulgar/creditar. Sempre texto puro em vez
    // de <@discord_id>, mesmo quando o cliente tem discord_id vinculado.
    const customerLabel = `**${customerProfile?.username ?? 'Cliente'}**`
    const boosterLabel = boosterProfile?.discord_id
      ? `<@${boosterProfile.discord_id}>`
      : `**${boosterRow?.display_name ?? 'Booster EloPeak'}**`
    const reviewerName = customerProfile?.username ?? 'Cliente'
    // Link de destino do embed (título clicável) vai pro perfil público do
    // booster (/boosters/:displayName, mesma rota usada em Services.tsx/
    // OrderDetail.tsx/BoostersPage.tsx -- display_name, não booster_id) em
    // vez do painel admin -- a review é uma mensagem pública, então deve
    // levar pra algo que qualquer um no Discord consegue abrir. Sem
    // display_name (booster sem perfil, edge case), cai pro pedido no
    // admin como já fazia antes.
    const boosterProfileUrl = boosterRow?.display_name
      ? `${APP_URL}/boosters/${encodeURIComponent(boosterRow.display_name)}`
      : `${APP_URL}/admin/orders/${review.order_id}`

    // Mesmo bloco padronizado-mas-dinâmico do buildOrderFields em
    // discord-order-channel (coreServiceFields) -- Modo/Fila só aparecem pra
    // quem tem esse conceito. order só é null se a FK tiver sido apagada
    // (não deveria acontecer), fallback vira só o campo Serviço.
    const coreFields = order ? coreServiceFields(order) : [{ name: '🛠️ Serviço', value: '—', inline: true }]
    const thumbnailUrl = cardThumbnailUrl(APP_URL, order ? rankIconTier(order) : null)

    const discordRes = await fetchWithTimeout(`${DISCORD_API}/channels/${CHANNEL_REVIEWS}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `⭐ **${reviewerName}** avaliou o serviço com ${review.rating} estrela${review.rating === 1 ? '' : 's'}!`,
        embeds: [{
          title: 'Nova Avaliação Disponível!',
          url: boosterProfileUrl,
          description: review.content?.trim() ? `"${escapeDiscordMarkdown(review.content.trim())}"` : '_Sem comentário_',
          color: 0xFACC15,
          fields: [
            ...coreFields,
            { name: '⭐ Nota', value: starBar(review.rating), inline: true },
            { name: '🧑‍💻 Booster', value: boosterLabel, inline: true },
            { name: '🙋 Cliente', value: customerLabel, inline: true },
          ],
          thumbnail: { url: thumbnailUrl },
          footer: eloPeakFooter(APP_URL),
        }],
        allowed_mentions: { parse: ['users'] },
      }),
    })

    if (!discordRes.ok) {
      console.error('Discord send review message failed', discordRes.status, await discordRes.text())
      return jsonResponse(req, { error: 'discord_send_failed' }, 502)
    }

    return jsonResponse(req, { ok: true, action: 'announced' })
  } catch (err) {
    console.error('discord-review-announcement error:', err)
    return jsonResponse(req, { error: 'internal_error' }, 500)
  }
})
