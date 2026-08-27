import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { z } from 'https://esm.sh/zod@3.23.8'
import { jsonResponse } from '../_shared/responses.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts'
import { MODAL_SERVICE_TYPES, coreServiceFields, rankIconTier, cardThumbnailUrl, eloPeakFooter } from '../_shared/discordRankFormat.ts'

const DISCORD_API            = 'https://discord.com/api/v10'
const BOT_TOKEN               = Deno.env.get('DISCORD_BOT_TOKEN')             ?? ''
const GUILD_ID                = Deno.env.get('DISCORD_GUILD_ID')              ?? ''
const ADMIN_ROLE_ID           = Deno.env.get('DISCORD_ADMIN_ROLE_ID')         ?? ''
const WEBHOOK_SECRET          = Deno.env.get('DISCORD_WEBHOOK_SECRET')        ?? ''
const CHANNEL_JOBS            = Deno.env.get('DISCORD_CHANNEL_JOBS')          ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app').replace(/\/$/, '')

// Categoria (grupo de canais) onde o canal de voz de cada pedido é criado --
// ID de categoria não é credencial, mesmo padrão de CHANNEL_JOBS/CHANNEL_TOP3
// (discord-top3-announcement), hardcoded direto em vez de secret/env.
const CATEGORY_VOICE_ORDERS = '1515459887004516523'

// Mesmo split de boosterEarningsShare() (ver src/lib/utils.ts) -- a
// mensagem vale pra todos os boosters de uma vez, então mostra a faixa
// (normal a top3) em vez de um valor fixo que só valeria pra alguns.
const BOOSTER_SHARE_NORMAL = 0.55
const BOOSTER_SHARE_TOP3   = 0.60
// Coaching não segue o split normal/top3 -- comissão fixa de 70% pro booster
// (mesma regra usada em trg_fn_order_completed_booster_stats, migration
// 20260824050000).
const BOOSTER_SHARE_COACHING = 0.70

// Addons cujo pedido exige comunicação em tempo real entre cliente e
// booster (voice do jogo ou transmissão da tela) -- junto com todo pedido de
// coaching (a aula acontece por voz), disparam a criação automática de um
// canal de voz privado (ver BOOST_ADDON_CODES em shared/boostDomain.ts pra
// lista completa de codes válidos por fluxo).
const VOICE_ADDON_CODES = ['duo_voice', 'live_stream']

// Mirrors LANE_LABEL/LANES em src/lib/lolTaxonomy.ts (não importável aqui --
// runtime Deno separado do bundle Vite, mesmo motivo pelo qual RANK_TIER_LABEL
// acima também é duplicado em vez de importado). Mesmo rótulo usado no site
// (Top/Jungle/Mid/Adc/Sup) -- só aqui, no Discord, cada um leva um emoji
// próprio na frente pra dar pra reconhecer a rota sem precisar ler o texto.
const LANE_LABEL: Record<string, string> = {
  top: 'Top', jungle: 'Jungle', mid: 'Mid', bot: 'Adc', support: 'Sup',
}
const LANE_EMOJI: Record<string, string> = {
  top: '🗡️', jungle: '🌳', mid: '✨', bot: '🏹', support: '🛡️',
}
const LANE_KEYS = ['top', 'jungle', 'mid', 'bot', 'support']

// Bit flags de permission_overwrites do Discord.
const VIEW_CHANNEL          = 1024
const CONNECT               = 1048576
const SPEAK                 = 2097152

const VOICE_ALLOW   = String(VIEW_CHANNEL + CONNECT + SPEAK)
const DENY_EVERYONE = String(VIEW_CHANNEL) // deny VIEW_CHANNEL for @everyone

const TERMINAL = ['completed', 'canceled', 'refunded', 'disputed', 'drop_requested']

// Cargo avisado em todo anúncio público (canal de jobs) -- só o cargo base
// "LoL Booster", nunca o de Top3 também: todo booster Top3 já tem o cargo
// base (não são exclusivos entre si), então mencionar os dois dava ping
// duplo pra quem é Top3. ID de cargo não é credencial, mesmo padrão de
// CHANNEL_TOP3 (discord-top3-announcement), hardcoded direto em vez de
// secret/env.
const BOOSTER_ROLE_IDS = ['1515483947029499904']

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

async function fetchOrderProfiles(orderId: string) {
  const db = supabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select(`
      id, status, customer_id, assigned_booster_id, preferred_booster_id, exclusive_until,
      service_id, discord_voice_channel_id, discord_text_channel_id,
      service_type, boost_mode, queue_type, server, current_rank, target_rank,
      clash_tier, clash_day, wins_purchased, sessions_purchased, total_price, estimated_hours, extras,
      customer_lanes, booster_service_id
    `)
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Order not found')

  const userIds = [order.customer_id, order.assigned_booster_id, order.preferred_booster_id].filter(Boolean)
  const boosterUserIds = [order.assigned_booster_id, order.preferred_booster_id].filter(Boolean)

  const [{ data: profiles }, { data: boosterProfiles }, { data: coachPackage }] = await Promise.all([
    db.from('profiles').select('id, username, discord_id').in('id', userIds),
    boosterUserIds.length
      ? db.from('booster_profiles').select('user_id, display_name').in('user_id', boosterUserIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string }[] }),
    // Título do pacote cadastrado pelo booster (booster_services.title) --
    // só existe pra coaching (booster_service_id sempre null nos outros
    // service_types, ver orderPricing.ts).
    order.booster_service_id
      ? db.from('booster_services').select('title').eq('id', order.booster_service_id).maybeSingle()
      : Promise.resolve({ data: null as { title: string } | null }),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
  const displayNameByUserId = new Map((boosterProfiles ?? []).map((b) => [b.user_id, b.display_name]))

  return {
    order: { ...order, coach_package_title: coachPackage?.title ?? null },
    customer: profileById.get(order.customer_id) ?? null,
    booster: order.assigned_booster_id ? profileById.get(order.assigned_booster_id) ?? null : null,
    boosterDisplayName: order.assigned_booster_id ? displayNameByUserId.get(order.assigned_booster_id) ?? null : null,
    preferredBooster: order.preferred_booster_id ? profileById.get(order.preferred_booster_id) ?? null : null,
    preferredDisplayName: order.preferred_booster_id ? displayNameByUserId.get(order.preferred_booster_id) ?? null : null,
  }
}

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

const currency = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

// Rotas escolhidas pelo cliente no configurador (orders.customer_lanes) --
// solo = rota que o booster deve jogar; duo = rota do cliente + o que sobra
// pro booster (mesma semântica de getLaneDisplayItems em src/lib/lolTaxonomy.ts).
// Sempre devolve 1 campo só (nunca 2), mesmo em duo -- as duas linhas (cliente
// + disponíveis) viram um valor multi-linha dentro do MESMO field, pra não
// mudar o tamanho do card entre solo e duo.
// deno-lint-ignore no-explicit-any
function lanesValue(order: any): string {
  const customerLanes: string[] = order.customer_lanes ?? []
  if (!customerLanes.length) return '---'
  const laneNames = (keys: string[]) => keys.map((k) => `${LANE_EMOJI[k] ?? ''} ${LANE_LABEL[k] ?? k}`.trim()).join(', ')
  if (order.boost_mode === 'duo') {
    const available = LANE_KEYS.filter((k) => !customerLanes.includes(k))
    return `Cliente: ${laneNames(customerLanes)}\nDisponíveis: ${laneNames(available)}`
  }
  return laneNames(customerLanes)
}

// Campos padronizados (mesma posição/ordem, mesmo ícone por tipo -- ver
// coreServiceFields) mas dinâmicos em quais aparecem: Rotas e Addons só
// existem pra quem tem esse conceito no configurador (MODAL_SERVICE_TYPES --
// elo_boost/win_boost/md5/clash), coaching e MD5 Completo não têm rota nem
// addon nenhum pra escolher, então o title nem aparece (em vez de "—").
// deno-lint-ignore no-explicit-any
function buildOrderFields(order: any) {
  const extras: { name: string }[] = order.extras ?? []
  const hasLanesAndAddons = MODAL_SERVICE_TYPES.includes(order.service_type)

  const fields: { name: string; value: string; inline?: boolean }[] = [
    ...coreServiceFields(order),
    { name: '⏱️ Tempo Estimado', value: order.estimated_hours ? `${order.estimated_hours}h` : '—', inline: true },
    ...(hasLanesAndAddons ? [{ name: '🗺️ Rotas', value: lanesValue(order), inline: true }] : []),
    ...(hasLanesAndAddons ? [{ name: '⭐ Addons', value: extras.length ? extras.map((e) => e.name).join(', ') : '—', inline: true }] : []),
  ]

  if (typeof order.total_price === 'number') {
    const isCoaching = order.service_type === 'coaching'
    const min = order.total_price * (isCoaching ? BOOSTER_SHARE_COACHING : BOOSTER_SHARE_NORMAL)
    const max = order.total_price * (isCoaching ? BOOSTER_SHARE_COACHING : BOOSTER_SHARE_TOP3)
    fields.push({
      name: '💰 Ganhos Estimados',
      value: isCoaching
        ? `${currency(min)} (70% do valor do pacote)`
        : `${currency(min)} – ${currency(max)} (varia conforme a comissão do booster)`,
      inline: false,
    })
  }

  return fields
}

// Botão sempre aponta pra /booster/jobs -- pedidos na pool (awaiting_assignment,
// público ou reservado) não têm página de detalhe própria, os cards de lá
// são aceitar/recusar inline (ver comentário em src/app/router.tsx sobre
// /booster/jobs/:id não existir).
function jobsButton(label: string) {
  return {
    type: 1,
    components: [{ type: 2, style: 5, label, url: `${APP_URL}/booster/jobs` }],
  }
}

// Anúncio público no canal de jobs -- só pra pedidos SEM booster preferido
// (ver buildExclusiveJobDM pra pedidos reservados/coaching, que vão direto
// no PV do booster dono em vez de aparecer aqui).
// deno-lint-ignore no-explicit-any
function buildPublicJobEmbed(order: any) {
  const shortCode = String(order.id).slice(0, 8).toUpperCase()
  return {
    content: BOOSTER_ROLE_IDS.map((id) => `<@&${id}>`).join(' '),
    allowed_mentions: { roles: BOOSTER_ROLE_IDS },
    embeds: [{
      title: `🆕 Novo Pedido #${shortCode}`,
      url: `${APP_URL}/booster/jobs`,
      description: 'Seja rápido! Pedidos são atribuídos por ordem de aceite.',
      color: 0x22C55E,
      fields: buildOrderFields(order),
      thumbnail: { url: cardThumbnailUrl(APP_URL, rankIconTier(order)) },
      footer: eloPeakFooter(APP_URL),
    }],
    components: [jobsButton('Visualizar na Aba Jobs')],
  }
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
      title: isCoaching ? '🎓 Novo Pedido de Coaching Reservado pra Você!' : '🔒 Novo Pedido Reservado pra Você!',
      url: `${APP_URL}/booster/jobs`,
      description: `Pedido #${shortCode} — ${isCoaching ? 'esse pacote é exclusivamente seu.' : 'só você pode aceitar esse pedido por enquanto.'}`,
      color: 0x8B5CF6,
      fields,
      thumbnail: { url: cardThumbnailUrl(APP_URL, rankIconTier(order)) },
      footer: eloPeakFooter(APP_URL),
    }],
    components: [jobsButton('Ver na Aba Jobs')],
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
