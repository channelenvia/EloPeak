import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { rankIconTier, cardThumbnailUrl, eloPeakFooter } from '../_shared/discordRankFormat.ts'
import {
  DISCORD_API, BOT_TOKEN, CHANNEL_JOBS, APP_URL,
  fetchOrderProfiles, buildOrderFields, buildPublicJobEmbed, jobsButton, sendChannelMessage,
} from '../_shared/discordJobAnnounce.ts'

const GUILD_ID                = Deno.env.get('DISCORD_GUILD_ID')              ?? ''
const ADMIN_ROLE_ID           = Deno.env.get('DISCORD_ADMIN_ROLE_ID')         ?? ''
const WEBHOOK_SECRET          = Deno.env.get('DISCORD_WEBHOOK_SECRET')        ?? ''

// Categoria (grupo de canais) onde o canal de voz de cada pedido é criado --
// ID de categoria não é credencial, mesmo padrão de CHANNEL_JOBS/CHANNEL_TOP3
// (discord-top3-announcement), hardcoded direto em vez de secret/env.
const CATEGORY_VOICE_ORDERS = '1515459887004516523'

// Addons cujo pedido exige comunicação em tempo real entre cliente e
// booster (voice do jogo ou transmissão da tela) -- junto com todo pedido de
// coaching (a aula acontece por voz), disparam a criação automática de um
// canal de voz privado (ver BOOST_ADDON_CODES em shared/boostDomain.ts pra
// lista completa de codes válidos por fluxo).
const VOICE_ADDON_CODES = ['duo_voice', 'live_stream']

// Bit flags de permission_overwrites do Discord.
const VIEW_CHANNEL          = 1024
const CONNECT               = 1048576
const SPEAK                 = 2097152

const VOICE_ALLOW   = String(VIEW_CHANNEL + CONNECT + SPEAK)
const DENY_EVERYONE = String(VIEW_CHANNEL) // deny VIEW_CHANNEL for @everyone

const TERMINAL = ['completed', 'canceled', 'refunded', 'disputed', 'drop_requested']

const orderRecordSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
  discord_voice_channel_id: z.string().nullable().optional(),
  discord_text_channel_id: z.string().nullable().optional(),
}).passthrough()

const dbWebhookSchema = z.union([
  orderRecordSchema,
  z.object({
    record: orderRecordSchema,
    // O trigger (notify_discord_order_webhook, migration 177) manda
    // old_record.status = null explicitamente em todo INSERT (não há OLD
    // row pra ler) -- .optional() sozinho só aceita a chave ausente, não
    // `null` explícito, então toda criação de pedido caía aqui com 400
    // "invalid webhook payload" antes de chegar em qualquer lógica de negócio.
    old_record: z.object({ status: z.string().nullable().optional() }).passthrough().optional(),
  }).passthrough(),
])

async function createDiscordChannel(name: string, type: number, overwrites: object[], parentId?: string, topic?: string) {
  const body: Record<string, unknown> = { name, type, permission_overwrites: overwrites }
  if (parentId) body.parent_id = parentId
  if (topic) body.topic = topic

  const res = await fetchWithTimeout(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.error(`Discord create channel failed ${res.status}:`, await res.text())
    throw new Error(`Discord create channel ${res.status}`)
  }
  const channel = await res.json() as { id: string }
  return channel.id
}

// Um único canal de VOZ por pedido (não canal de texto -- o chat do pedido
// já existe dentro do próprio site, ver OrderChat) -- só cliente, booster e
// admins têm acesso (permission_overwrites nega @everyone por padrão e só
// libera os 3). Categoria fixa (CATEGORY_VOICE_ORDERS), nome com o número do
// pedido. Canal de voz (type 2) não tem campo de tópico na API do Discord,
// diferente do de texto que esse fluxo criava antes -- por isso não recebe
// nome do cliente/booster, só o id do pedido no próprio nome do canal.
async function createOrderVoiceChannel(
  orderId: string,
  customerDiscordId: string | null,
  boosterDiscordId: string | null,
) {
  const shortId = orderId.slice(0, 8)

  const voiceOverwrites: object[] = [{ id: GUILD_ID, type: 0, deny: DENY_EVERYONE }]
  if (customerDiscordId) voiceOverwrites.push({ id: customerDiscordId, type: 1, allow: VOICE_ALLOW })
  if (boosterDiscordId) voiceOverwrites.push({ id: boosterDiscordId, type: 1, allow: VOICE_ALLOW })
  if (ADMIN_ROLE_ID) voiceOverwrites.push({ id: ADMIN_ROLE_ID, type: 0, allow: VOICE_ALLOW })

  const voiceChannelId = await createDiscordChannel(`voz-${shortId}`, 2, voiceOverwrites, CATEGORY_VOICE_ORDERS)
  return { voiceChannelId }
}

async function deleteDiscordChannel(channelId: string) {
  const res = await fetchWithTimeout(`${DISCORD_API}/channels/${channelId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  })
  // 404 = already deleted, that's fine
  if (!res.ok && res.status !== 404) {
    console.error(`Discord delete channel failed ${res.status}:`, await res.text())
    throw new Error(`Discord delete channel ${res.status}`)
  }
}

async function deleteOrderChannels(voiceChannelId: string | null, textChannelId: string | null) {
  await Promise.all([
    voiceChannelId ? deleteDiscordChannel(voiceChannelId) : Promise.resolve(),
    textChannelId ? deleteDiscordChannel(textChannelId) : Promise.resolve(),
  ])
}

// DM pro booster dono do pedido -- coaching (sempre reservado pro dono do
// pacote, exclusividade permanente) e pedidos "solicitados diretamente" via
// perfil público (reservados por 12h antes de caírem pro pool geral). Nos
// dois casos o pedido nem aparece no canal público de jobs -- ver
// buildPublicJobEmbed/awaiting_assignment abaixo.
// deno-lint-ignore no-explicit-any
function buildExclusiveJobDM(order: any) {
  const shortCode = String(order.id).slice(0, 8).toUpperCase()
  const isCoaching = order.service_type === 'coaching'
  const isReassigned = order.reassigned_by_admin === true
  const fields = buildOrderFields(order)

  // Campo sempre presente (mesmo padrão dos demais -- "—"/texto fixo em vez
  // de omitir), inserido antes do campo de Ganhos (que fica sempre por
  // último). Coaching nunca expira (reserva permanente do dono do pacote).
  const expiresValue = isCoaching
    ? 'Sem expiração (pacote seu)'
    : order.exclusive_until
      ? `${Math.max(1, Math.round((new Date(order.exclusive_until).getTime() - Date.now()) / 3_600_000))}h (depois volta pro pool geral)`
      : '—'
  fields.splice(fields.length - 1, 0, { name: '⏳ Expira em', value: expiresValue, inline: true })

  return {
    embeds: [{
      title: isCoaching
        ? '🎓 Novo Pedido de Coaching Reservado pra Você!'
        : isReassigned
          ? '🔁 Pedido Reatribuído pra Você!'
          : '🔒 Novo Pedido Reservado pra Você!',
      url: `${APP_URL}/booster/jobs`,
      description: `Pedido #${shortCode} — ${
        isCoaching
          ? 'esse pacote é exclusivamente seu.'
          : isReassigned
            ? 'um administrador reatribuiu este pedido a você. Só você pode aceitá-lo por enquanto.'
            : 'só você pode aceitar esse pedido por enquanto.'
      }`,
      color: isReassigned ? 0xEF4444 : 0x8B5CF6,
      fields,
      thumbnail: { url: cardThumbnailUrl(APP_URL, rankIconTier(order)) },
      footer: eloPeakFooter(APP_URL),
    }],
    components: [jobsButton('Ver na Aba Jobs')],
  }
}

// DM direto -- Discord exige abrir (ou reaproveitar) o canal de DM com o
// usuário antes de mandar qualquer mensagem direta (idempotente, sempre
// retorna o mesmo channel id pra um par bot/usuário).
async function sendDirectMessage(discordUserId: string, payload: object) {
  const dmRes = await fetchWithTimeout(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: discordUserId }),
  })
  if (!dmRes.ok) {
    console.error(`Discord create DM channel failed ${dmRes.status}:`, await dmRes.text())
    throw new Error(`Discord create DM channel ${dmRes.status}`)
  }
  const dmChannel = await dmRes.json() as { id: string }
  await sendChannelMessage(dmChannel.id, payload)
}

// discord_text_channel_id nunca é setado por esse fluxo (só canal de voz,
// ver createOrderVoiceChannel) -- o parâmetro continua existindo só pro
// caminho de deleção (TERMINAL abaixo) zerar os dois de uma vez, incluindo
// um eventual canal de texto legado de pedido criado antes dessa mudança.
async function saveChannelIds(orderId: string, voiceChannelId: string | null, textChannelId: string | null) {
  await supabaseAdmin()
    .from('orders')
    .update({ discord_voice_channel_id: voiceChannelId, discord_text_channel_id: textChannelId })
    .eq('id', orderId)
}

serve(async (req) => {
  if (!BOT_TOKEN || !GUILD_ID) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const auth = await verifyWebhookRequest(req, { scope: 'discord-order-channel', webhookSecret: WEBHOOK_SECRET, maxBytes: 32 * 1024 })
  if (!auth.ok) return auth.response

  const parsedPayload = dbWebhookSchema.safeParse(auth.rawBody)
  if (!parsedPayload.success) {
    return jsonResponse(req, { error: 'invalid webhook payload' }, 400)
  }

  // Supabase Database Webhooks wrap the row in { type, table, record, old_record }.
  // dbWebhookSchema é um union de dois formatos com .passthrough() em ambos
  // -- o index signature do passthrough impede o TS de estreitar o union só
  // com `'record' in payload` (as duas variantes "aceitam" a chave `record`
  // estruturalmente), então record/oldRecord saem `unknown`/`{}` mesmo já
  // validados pelo Zod acima. Cast explícito pro formato que o Zod garantiu.
  const payload = parsedPayload.data
  const record = ('record' in payload ? payload.record : payload) as z.infer<typeof orderRecordSchema>
  const oldRecord = ('record' in payload ? payload.old_record ?? {} : {}) as { status?: string }

  const orderId:               string        = record.id
  const newStatus:              string        = record.status
  const oldStatus:              string        = oldRecord.status ?? ''
  const existingVoiceChannelId: string | null = record.discord_voice_channel_id ?? null
  const existingTextChannelId:  string | null = record.discord_text_channel_id ?? null

  try {
    // ── Cria canal de voz quando o pedido entra em execução e precisa ──────────
    // Addon de voice/compartilhar tela, OU qualquer pedido de coaching (a
    // aula sempre acontece por voz) -- só um canal de voz, nunca texto (o
    // chat do pedido já existe dentro do site, ver OrderChat).
    if (newStatus === 'in_progress' && oldStatus !== 'in_progress' && !existingVoiceChannelId && !existingTextChannelId) {
      const { order, customer, booster } = await fetchOrderProfiles(orderId)

      // O payload do webhook não é reconferido contra o banco em nenhum outro
      // ponto — sem isso, a posse do DISCORD_WEBHOOK_SECRET (compartilhado com
      // discord-init-channels) seria suficiente pra forjar `status` e criar/
      // apagar canais fora de sincronia com o estado real do pedido.
      if (order.status !== 'in_progress') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      const extras: { code?: string }[] = order.extras ?? []
      const needsVoiceChannel = order.service_type === 'coaching'
        || extras.some((extra) => VOICE_ADDON_CODES.includes(extra.code ?? ''))
      if (!needsVoiceChannel) {
        return jsonResponse(req, { ok: true, action: 'skipped_no_voice_addon' })
      }

      if (!customer?.discord_id && !booster?.discord_id) {
        return jsonResponse(req, { ok: false, reason: 'no discord_ids found for customer or booster' })
      }

      const { voiceChannelId } = await createOrderVoiceChannel(
        order.id,
        customer?.discord_id ?? null,
        booster?.discord_id  ?? null,
      )
      await saveChannelIds(orderId, voiceChannelId, null)

      return jsonResponse(req, { ok: true, action: 'created', voiceChannelId })
    }

    // ── Anuncia quando o pedido fica disponível ───────────────────────────────
    // Cobre todos os caminhos que levam a awaiting_assignment: pagamento
    // confirmado (com ou sem credenciais pendentes) e reabertura por drop
    // (booster ou cliente) -- todos passam por UPDATE status em orders, então
    // caem nesse mesmo webhook. Sem exceção: todo pedido passa por aqui.
    //
    // Pedido com preferred_booster_id é reservado a um booster específico
    // (coaching -- sempre; ou "solicitação direta" via perfil público -- 12h,
    // ver available_boost_orders/process_mp_payment_event) e NUNCA aparece
    // no canal público: só o booster dono vê, direto no PV dele. Pedido sem
    // preferred_booster_id é público, segue anunciando no canal de jobs.
    if (newStatus === 'awaiting_assignment' && oldStatus !== 'awaiting_assignment') {
      const { order, preferredBooster } = await fetchOrderProfiles(orderId)
      if (order.status !== 'awaiting_assignment') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      if (order.preferred_booster_id) {
        if (!preferredBooster?.discord_id) {
          return jsonResponse(req, { ok: true, action: 'skipped_no_discord_id' })
        }
        await sendDirectMessage(preferredBooster.discord_id, buildExclusiveJobDM(order))
        return jsonResponse(req, { ok: true, action: 'exclusive_job_dm_sent' })
      }

      if (!CHANNEL_JOBS) {
        return jsonResponse(req, { ok: false, reason: 'DISCORD_CHANNEL_JOBS not configured' })
      }
      await sendChannelMessage(CHANNEL_JOBS, buildPublicJobEmbed(order))
      return jsonResponse(req, { ok: true, action: 'job_announced' })
    }

    // ── Apaga os canais quando o pedido é encerrado ───────────────────────────
    if (TERMINAL.includes(newStatus) && (existingVoiceChannelId || existingTextChannelId)) {
      const { order } = await fetchOrderProfiles(orderId)
      if (!TERMINAL.includes(order.status)) {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      await deleteOrderChannels(existingVoiceChannelId, existingTextChannelId)
      await saveChannelIds(orderId, null, null)

      return jsonResponse(req, { ok: true, action: 'deleted' })
    }

    return jsonResponse(req, { ok: true, action: 'skipped' })
  } catch (err) {
    console.error('discord-order-channel error:', err)
    return jsonResponse(req, { error: 'discord_channel_error' }, 500)
  }
})
