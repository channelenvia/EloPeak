import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { rateLimitResponse } from '../_shared/responses.ts'
import { CLASH_TIER_LABEL, CLASH_DAY_LABEL } from '../../../shared/clashDomain.ts'

const DISCORD_API            = 'https://discord.com/api/v10'
const BOT_TOKEN               = Deno.env.get('DISCORD_BOT_TOKEN')             ?? ''
const GUILD_ID                = Deno.env.get('DISCORD_GUILD_ID')              ?? ''
const ADMIN_ROLE_ID           = Deno.env.get('DISCORD_ADMIN_ROLE_ID')         ?? ''
const CATEGORY_VOICE_EXTRAS   = Deno.env.get('DISCORD_CATEGORY_VOICE_EXTRAS') ?? ''
const WEBHOOK_SECRET          = Deno.env.get('DISCORD_WEBHOOK_SECRET')        ?? ''
const CHANNEL_JOBS            = Deno.env.get('DISCORD_CHANNEL_JOBS')          ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app').replace(/\/$/, '')

// Mesmo split de boosterEarningsShare() (ver src/lib/utils.ts) -- a
// mensagem vale pra todos os boosters de uma vez, então mostra a faixa
// (normal a top3) em vez de um valor fixo que só valeria pra alguns.
const BOOSTER_SHARE_NORMAL = 0.55
const BOOSTER_SHARE_TOP3   = 0.60

// Addons cujo pedido exige comunicação em tempo real entre cliente e
// booster (voice do jogo ou transmissão da tela) -- só esses disparam a
// criação automática de canal de texto+voz (ver BOOST_ADDON_CODES em
// shared/boostDomain.ts para a lista completa de codes válidos por fluxo).
const VOICE_ADDON_CODES = ['duo_voice', 'live_stream']

const RANK_TIER_LABEL: Record<string, string> = {
  iron: 'Ferro', bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina',
  emerald: 'Esmeralda', diamond: 'Diamante', master: 'Mestre', grandmaster: 'Grão-mestre', challenger: 'Desafiante',
}

// Bit flags de permission_overwrites do Discord.
const VIEW_CHANNEL          = 1024
const SEND_MESSAGES         = 2048
const READ_MESSAGE_HISTORY  = 65536
const CONNECT               = 1048576
const SPEAK                 = 2097152

const VOICE_ALLOW   = String(VIEW_CHANNEL + CONNECT + SPEAK)
const TEXT_ALLOW    = String(VIEW_CHANNEL + SEND_MESSAGES + READ_MESSAGE_HISTORY)
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
    old_record: z.object({ status: z.string().optional() }).passthrough().optional(),
  }).passthrough(),
])

async function fetchOrderProfiles(orderId: string) {
  const db = supabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select(`
      id, status, customer_id, assigned_booster_id, preferred_booster_id, exclusive_until,
      service_id, discord_voice_channel_id, discord_text_channel_id,
      service_type, boost_mode, queue_type, server, current_rank, target_rank,
      clash_tier, clash_day, wins_purchased, sessions_purchased, total_price, estimated_hours, extras
    `)
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Order not found')

  const userIds = [order.customer_id, order.assigned_booster_id, order.preferred_booster_id].filter(Boolean)
  const boosterUserIds = [order.assigned_booster_id, order.preferred_booster_id].filter(Boolean)

  const [{ data: profiles }, { data: boosterProfiles }] = await Promise.all([
    db.from('profiles').select('id, username, discord_id').in('id', userIds),
    boosterUserIds.length
      ? db.from('booster_profiles').select('user_id, display_name').in('user_id', boosterUserIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string }[] }),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
  const displayNameByUserId = new Map((boosterProfiles ?? []).map((b) => [b.user_id, b.display_name]))

  return {
    order,
    customer: profileById.get(order.customer_id) ?? null,
    booster: order.assigned_booster_id ? profileById.get(order.assigned_booster_id) ?? null : null,
    boosterDisplayName: order.assigned_booster_id ? displayNameByUserId.get(order.assigned_booster_id) ?? null : null,
    preferredDisplayName: order.preferred_booster_id ? displayNameByUserId.get(order.preferred_booster_id) ?? null : null,
  }
}

async function createDiscordChannel(name: string, type: number, overwrites: object[], topic?: string) {
  const body: Record<string, unknown> = { name, type, permission_overwrites: overwrites }
  if (CATEGORY_VOICE_EXTRAS) body.parent_id = CATEGORY_VOICE_EXTRAS
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

// Cria o canal de texto e o de voz do pedido lado a lado -- ambos levam o
// tópico com cliente/booster (associados automaticamente pelo discord_id
// já resolvido em fetchOrderProfiles) para quem entrar já saber quem é quem.
async function createOrderChannels(
  orderId: string,
  customerDiscordId: string | null,
  boosterDiscordId: string | null,
  customerName: string | null,
  boosterName: string | null,
) {
  const shortId = orderId.slice(0, 8)

  const textOverwrites: object[] = [{ id: GUILD_ID, type: 0, deny: DENY_EVERYONE }]
  const voiceOverwrites: object[] = [{ id: GUILD_ID, type: 0, deny: DENY_EVERYONE }]

  if (customerDiscordId) {
    textOverwrites.push({ id: customerDiscordId, type: 1, allow: TEXT_ALLOW })
    voiceOverwrites.push({ id: customerDiscordId, type: 1, allow: VOICE_ALLOW })
  }
  if (boosterDiscordId) {
    textOverwrites.push({ id: boosterDiscordId, type: 1, allow: TEXT_ALLOW })
    voiceOverwrites.push({ id: boosterDiscordId, type: 1, allow: VOICE_ALLOW })
  }
  if (ADMIN_ROLE_ID) {
    textOverwrites.push({ id: ADMIN_ROLE_ID, type: 0, allow: TEXT_ALLOW })
    voiceOverwrites.push({ id: ADMIN_ROLE_ID, type: 0, allow: VOICE_ALLOW })
  }

  const topic = `Cliente: ${customerName ?? '—'} • Booster: ${boosterName ?? '—'} • Pedido ${shortId}`

  const [textChannelId, voiceChannelId] = await Promise.all([
    createDiscordChannel(`chat-${shortId}`, 0, textOverwrites, topic),
    createDiscordChannel(`voz-${shortId}`, 2, voiceOverwrites),
  ])

  return { textChannelId, voiceChannelId }
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

function formatRankValue(rank: { tier?: string; division?: string | null } | null | undefined) {
  if (!rank?.tier) return null
  const label = RANK_TIER_LABEL[rank.tier] ?? rank.tier
  if (!rank.division || ['master', 'grandmaster', 'challenger'].includes(rank.tier)) return label
  return `${label} ${rank.division}`
}

// Mirrors getOrderModeType() em src/lib/utils.ts -- rótulo específico da
// variação do pedido (não só a categoria do serviço).
function getOrderModeLabel(order: { service_type?: string | null; boost_mode?: string | null }) {
  switch (order.service_type) {
    case 'elo_boost': return order.boost_mode === 'duo' ? 'Duo Boost' : 'Solo Boost'
    case 'win_boost': return 'Vitórias'
    case 'md5': return 'MD5'
    case 'coaching': return 'Coaching'
    case 'placement_matches': return 'MD5 Completo'
    case 'clash': return order.boost_mode === 'duo' ? 'Duo Clash' : 'Solo Clash'
    default: return order.service_type ?? '—'
  }
}

const currency = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

// deno-lint-ignore no-explicit-any
function buildNewOrderEmbed(order: any, preferredDisplayName: string | null) {
  const shortCode = String(order.id).slice(0, 8).toUpperCase()
  const fields: { name: string; value: string; inline?: boolean }[] = []

  fields.push({ name: 'Serviço', value: getOrderModeLabel(order), inline: true })
  fields.push({ name: 'Fila', value: order.queue_type === 'flex' ? 'Flex' : 'Solo/Duo', inline: true })

  // Campos variam por service_type -- cada modalidade tem sua própria
  // combinação de dados relevantes pro booster decidir se quer pegar o
  // pedido (servidor não entra aqui: a plataforma só atende BR).
  const current = formatRankValue(order.current_rank)
  switch (order.service_type) {
    case 'clash': {
      if (order.clash_tier) fields.push({ name: 'Tier', value: CLASH_TIER_LABEL[order.clash_tier as never] ?? order.clash_tier, inline: true })
      if (order.clash_day)  fields.push({ name: 'Dia',  value: CLASH_DAY_LABEL[order.clash_day as never] ?? order.clash_day, inline: true })
      break
    }
    case 'elo_boost': {
      const target = formatRankValue(order.target_rank)
      if (current) fields.push({ name: 'Elo Atual', value: current, inline: true })
      if (target)  fields.push({ name: 'Elo Alvo', value: target, inline: true })
      break
    }
    case 'win_boost':
    case 'md5': {
      if (current) fields.push({ name: 'Elo Atual', value: current, inline: true })
      if (order.wins_purchased) fields.push({ name: 'Vitórias', value: `${order.wins_purchased} vitórias`, inline: true })
      break
    }
    case 'placement_matches': {
      if (current) fields.push({ name: 'Elo Atual', value: current, inline: true })
      fields.push({ name: 'Partidas', value: '5 partidas', inline: true })
      break
    }
    case 'coaching': {
      if (order.sessions_purchased) fields.push({ name: 'Sessões', value: String(order.sessions_purchased), inline: true })
      break
    }
    default: {
      const target = formatRankValue(order.target_rank)
      if (current) fields.push({ name: 'Elo Atual', value: target ? `${current} → ${target}` : current, inline: true })
    }
  }

  if (order.estimated_hours) fields.push({ name: 'Tempo estimado', value: `${order.estimated_hours}h`, inline: true })

  const extras: { name: string }[] = order.extras ?? []
  if (extras.length) {
    fields.push({ name: '⭐ Addons', value: extras.map((e) => e.name).join(', '), inline: false })
  }

  const exclusiveActive = order.preferred_booster_id && order.exclusive_until
    && new Date(order.exclusive_until).getTime() > Date.now()
  if (exclusiveActive && preferredDisplayName) {
    const hoursLeft = Math.max(1, Math.round((new Date(order.exclusive_until).getTime() - Date.now()) / 3_600_000))
    fields.push({
      name: '🔒 Booster Pré-selecionado',
      value: `Booster ${preferredDisplayName} (reservado por ${hoursLeft}h)`,
      inline: false,
    })
  }

  if (typeof order.total_price === 'number') {
    const min = order.total_price * BOOSTER_SHARE_NORMAL
    const max = order.total_price * BOOSTER_SHARE_TOP3
    fields.push({
      name: 'Ganhos Estimados',
      value: `${currency(min)} – ${currency(max)} (varia conforme a comissão do booster)`,
      inline: false,
    })
  }

  return {
    embeds: [{
      title: `🆕 Novo Pedido #${shortCode}`,
      color: 0x22C55E,
      fields,
      footer: { text: 'EloPeak • Seja rápido! Pedidos são atribuídos por ordem de aceite' },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'Visualizar no Marketplace',
        url: `${APP_URL}/booster/jobs/${order.id}`,
      }],
    }],
  }
}

async function sendChannelMessage(channelId: string, payload: object) {
  const res = await fetchWithTimeout(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error(`Discord send message failed ${res.status}:`, await res.text())
    throw new Error(`Discord send message ${res.status}`)
  }
}

async function saveChannelIds(orderId: string, voiceChannelId: string | null, textChannelId: string | null) {
  await supabaseAdmin()
    .from('orders')
    .update({ discord_voice_channel_id: voiceChannelId, discord_text_channel_id: textChannelId })
    .eq('id', orderId)
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!WEBHOOK_SECRET) {
    return new Response('Server misconfigured', { status: 500 })
  }

  if (!BOT_TOKEN || !GUILD_ID) {
    return new Response('Server misconfigured', { status: 500 })
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await consumeUserRateLimit('discord-order-channel', 'database-webhook', 120, 60)
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.retryAfter)

  let rawPayload: unknown
  try {
    rawPayload = await readJsonBody(req, 32 * 1024)
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse(req, { error: err.message }, err.status)
    return jsonResponse(req, { error: 'invalid request' }, 400)
  }

  const parsedPayload = dbWebhookSchema.safeParse(rawPayload)
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
    // ── Cria canal de texto+voz quando o pedido entra em execução e tem
    // addon de voice/compartilhar tela ────────────────────────────────────
    if (newStatus === 'in_progress' && oldStatus !== 'in_progress' && !existingVoiceChannelId && !existingTextChannelId) {
      const { order, customer, booster, boosterDisplayName } = await fetchOrderProfiles(orderId)

      // O payload do webhook não é reconferido contra o banco em nenhum outro
      // ponto — sem isso, a posse do DISCORD_WEBHOOK_SECRET (compartilhado com
      // discord-init-channels) seria suficiente pra forjar `status` e criar/
      // apagar canais fora de sincronia com o estado real do pedido.
      if (order.status !== 'in_progress') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      const extras: { code?: string }[] = order.extras ?? []
      const needsVoiceChannels = extras.some((extra) => VOICE_ADDON_CODES.includes(extra.code ?? ''))
      if (!needsVoiceChannels) {
        return jsonResponse(req, { ok: true, action: 'skipped_no_voice_addon' })
      }

      if (!customer?.discord_id && !booster?.discord_id) {
        return jsonResponse(req, { ok: false, reason: 'no discord_ids found for customer or booster' })
      }

      const { textChannelId, voiceChannelId } = await createOrderChannels(
        order.id,
        customer?.discord_id ?? null,
        booster?.discord_id  ?? null,
        customer?.username   ?? null,
        boosterDisplayName,
      )
      await saveChannelIds(orderId, voiceChannelId, textChannelId)

      return jsonResponse(req, { ok: true, action: 'created', voiceChannelId, textChannelId })
    }

    // ── Anuncia no canal de pedidos quando o pedido fica disponível ───────────
    // Cobre todos os caminhos que levam a awaiting_assignment: pagamento
    // confirmado (com ou sem credenciais pendentes) e reabertura por drop
    // (booster ou cliente) -- todos passam por UPDATE status em orders, então
    // caem nesse mesmo webhook. Sem exceção: todo pedido passa por aqui.
    if (newStatus === 'awaiting_assignment' && oldStatus !== 'awaiting_assignment') {
      if (!CHANNEL_JOBS) {
        return jsonResponse(req, { ok: false, reason: 'DISCORD_CHANNEL_JOBS not configured' })
      }

      const { order, preferredDisplayName } = await fetchOrderProfiles(orderId)
      if (order.status !== 'awaiting_assignment') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      await sendChannelMessage(CHANNEL_JOBS, buildNewOrderEmbed(order, preferredDisplayName))
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
