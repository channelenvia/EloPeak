import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { constantTimeEqual } from '../_shared/crypto.ts'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout, HttpError, readJsonBody } from '../_shared/http.ts'
import { consumeUserRateLimit } from '../_shared/rateLimit.ts'
import { rateLimitResponse } from '../_shared/responses.ts'
import { CLASH_TIER_LABEL, CLASH_DAY_LABEL } from '../../../shared/clashDomain.ts'

const DISCORD_API     = 'https://discord.com/api/v10'
const BOT_TOKEN       = Deno.env.get('DISCORD_BOT_TOKEN')       ?? ''
const GUILD_ID        = Deno.env.get('DISCORD_GUILD_ID')        ?? ''
const ADMIN_ROLE_ID   = Deno.env.get('DISCORD_ADMIN_ROLE_ID')   ?? ''
const CATEGORY_ID     = Deno.env.get('DISCORD_CATEGORY_BOOSTS') ?? ''
const WEBHOOK_SECRET  = Deno.env.get('DISCORD_WEBHOOK_SECRET')  ?? ''
const CHANNEL_JOBS    = Deno.env.get('DISCORD_CHANNEL_JOBS')    ?? ''

// Mesmo split de boosterEarningsShare() (ver src/lib/utils.ts) -- a
// mensagem vale pra todos os boosters de uma vez, então mostra a faixa
// (normal a top3) em vez de um valor fixo que só valeria pra alguns.
const BOOSTER_SHARE_NORMAL = 0.55
const BOOSTER_SHARE_TOP3   = 0.60

const RANK_TIER_LABEL: Record<string, string> = {
  iron: 'Ferro', bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina',
  emerald: 'Esmeralda', diamond: 'Diamante', master: 'Mestre', grandmaster: 'Grão-mestre', challenger: 'Desafiante',
}

// Bit flags: VIEW_CHANNEL (1024) + CONNECT (1048576) + SPEAK (2097152)
const VOICE_ALLOW    = String(1024 + 1048576 + 2097152)
const DENY_EVERYONE  = String(1024) // deny VIEW_CHANNEL for @everyone

const TERMINAL = ['completed', 'canceled', 'refunded', 'disputed', 'drop_requested']

const orderRecordSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
  discord_voice_channel_id: z.string().nullable().optional(),
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
      id, status, customer_id, assigned_booster_id, service_id, discord_voice_channel_id,
      service_type, boost_mode, queue_type, server, current_rank, target_rank,
      clash_tier, clash_day, wins_purchased, sessions_purchased, total_price, estimated_hours
    `)
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Order not found')

  const ids = [order.customer_id, order.assigned_booster_id].filter(Boolean)
  const { data: profiles } = await db
    .from('profiles')
    .select('id, username, discord_id')
    .in('id', ids)

  return {
    order,
    customer: profiles?.find(p => p.id === order.customer_id) ?? null,
    booster:  profiles?.find(p => p.id === order.assigned_booster_id) ?? null,
  }
}

async function createVoiceChannel(orderId: string, customerDiscordId: string | null, boosterDiscordId: string | null) {
  const shortId = orderId.slice(0, 8)

  const overwrites: object[] = [
    { id: GUILD_ID, type: 0, deny: DENY_EVERYONE }, // block @everyone
  ]

  if (customerDiscordId) overwrites.push({ id: customerDiscordId, type: 1, allow: VOICE_ALLOW })
  if (boosterDiscordId)  overwrites.push({ id: boosterDiscordId,  type: 1, allow: VOICE_ALLOW })
  if (ADMIN_ROLE_ID)     overwrites.push({ id: ADMIN_ROLE_ID,     type: 0, allow: VOICE_ALLOW })

  const body: Record<string, unknown> = {
    name: `boost-${shortId}`,
    type: 2, // voice channel
    permission_overwrites: overwrites,
  }
  if (CATEGORY_ID) body.parent_id = CATEGORY_ID

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

async function deleteVoiceChannel(channelId: string) {
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
function buildJobAvailableEmbed(order: any) {
  const fields: { name: string; value: string; inline?: boolean }[] = []

  if (order.service_type === 'clash') {
    if (order.clash_tier) fields.push({ name: 'Tier', value: CLASH_TIER_LABEL[order.clash_tier as never] ?? order.clash_tier, inline: true })
    if (order.clash_day)  fields.push({ name: 'Dia',  value: CLASH_DAY_LABEL[order.clash_day as never] ?? order.clash_day, inline: true })
  } else {
    const current = formatRankValue(order.current_rank)
    const target = formatRankValue(order.target_rank)
    if (current) fields.push({ name: 'Rank', value: target ? `${current} → ${target}` : current, inline: true })
  }

  if (order.queue_type) fields.push({ name: 'Fila', value: order.queue_type === 'flex' ? 'Flex' : 'Solo/Duo', inline: true })
  if (order.server)     fields.push({ name: 'Servidor', value: order.server, inline: true })
  if (order.estimated_hours) fields.push({ name: 'Tempo estimado', value: `${order.estimated_hours}h`, inline: true })
  if (order.wins_purchased)    fields.push({ name: 'Vitórias', value: String(order.wins_purchased), inline: true })
  if (order.sessions_purchased) fields.push({ name: 'Sessões', value: String(order.sessions_purchased), inline: true })

  if (typeof order.total_price === 'number') {
    const min = order.total_price * BOOSTER_SHARE_NORMAL
    const max = order.total_price * BOOSTER_SHARE_TOP3
    fields.push({
      name: 'Você recebe',
      value: `${currency(min)} – ${currency(max)} (conforme seu ranking)`,
    })
  }

  return {
    embeds: [{
      title: '🆕 Novo pedido disponível',
      description: getOrderModeLabel(order),
      color: 0x22C55E,
      fields,
      footer: { text: 'Corre lá na aba JOBS pra pegar!' },
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

async function saveChannelId(orderId: string, channelId: string | null) {
  await supabaseAdmin()
    .from('orders')
    .update({ discord_voice_channel_id: channelId })
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

  const orderId:           string        = record.id
  const newStatus:         string        = record.status
  const oldStatus:         string        = oldRecord.status ?? ''
  const existingChannelId: string | null = record.discord_voice_channel_id ?? null

  try {
    // ── Create channel when order goes in_progress ───────────────────────────
    if (newStatus === 'in_progress' && oldStatus !== 'in_progress' && !existingChannelId) {
      const { order, customer, booster } = await fetchOrderProfiles(orderId)

      // O payload do webhook não é reconferido contra o banco em nenhum outro
      // ponto — sem isso, a posse do DISCORD_WEBHOOK_SECRET (compartilhado com
      // discord-init-channels) seria suficiente pra forjar `status` e criar/
      // apagar canais fora de sincronia com o estado real do pedido.
      if (order.status !== 'in_progress') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      if (!customer?.discord_id && !booster?.discord_id) {
        return jsonResponse(req, { ok: false, reason: 'no discord_ids found for customer or booster' })
      }

      const channelId = await createVoiceChannel(
        order.id,
        customer?.discord_id ?? null,
        booster?.discord_id  ?? null,
      )
      await saveChannelId(orderId, channelId)

      return jsonResponse(req, { ok: true, action: 'created', channelId })
    }

    // ── Anuncia no canal de jobs quando o pedido fica disponível ──────────────
    // Cobre todos os caminhos que levam a awaiting_assignment: pagamento
    // confirmado (com ou sem credenciais pendentes) e reabertura por drop
    // (booster ou cliente) -- todos passam por UPDATE status em orders, então
    // caem nesse mesmo webhook.
    if (newStatus === 'awaiting_assignment' && oldStatus !== 'awaiting_assignment') {
      if (!CHANNEL_JOBS) {
        return jsonResponse(req, { ok: false, reason: 'DISCORD_CHANNEL_JOBS not configured' })
      }

      const { order } = await fetchOrderProfiles(orderId)
      if (order.status !== 'awaiting_assignment') {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      await sendChannelMessage(CHANNEL_JOBS, buildJobAvailableEmbed(order))
      return jsonResponse(req, { ok: true, action: 'job_announced' })
    }

    // ── Delete channel when order is terminated ──────────────────────────────
    if (TERMINAL.includes(newStatus) && existingChannelId) {
      const { order } = await fetchOrderProfiles(orderId)
      if (!TERMINAL.includes(order.status)) {
        return jsonResponse(req, { ok: false, reason: 'order status mismatch, ignoring stale/forged payload' })
      }

      await deleteVoiceChannel(existingChannelId)
      await saveChannelId(orderId, null)

      return jsonResponse(req, { ok: true, action: 'deleted' })
    }

    return jsonResponse(req, { ok: true, action: 'skipped' })
  } catch (err) {
    console.error('discord-order-channel error:', err)
    return jsonResponse(req, { error: 'discord_channel_error' }, 500)
  }
})
