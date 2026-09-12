// Extraído de discord-order-channel/index.ts -- construção do embed público
// do canal de jobs e o fetch de order+profiles que o alimenta, reaproveitados
// por qualquer função que precise anunciar um pedido no canal público (hoje:
// o próprio discord-order-channel no fluxo normal de awaiting_assignment, e
// announce-expired-exclusive-jobs quando a exclusividade de um pedido
// reservado expira sem o booster preferido aceitar). Mesma fonte única,
// zero duplicação de formatação entre os dois anúncios.
import { fetchWithTimeout } from './http.ts'
import { supabaseAdmin } from './supabaseAdmin.ts'
import { MODAL_SERVICE_TYPES, coreServiceFields, rankIconTier, cardThumbnailUrl, eloPeakFooter } from './discordRankFormat.ts'

export const DISCORD_API = 'https://discord.com/api/v10'
export const BOT_TOKEN    = Deno.env.get('DISCORD_BOT_TOKEN')    ?? ''
export const CHANNEL_JOBS = Deno.env.get('DISCORD_CHANNEL_JOBS') ?? ''
export const APP_URL = (Deno.env.get('APP_URL') ?? Deno.env.get('PUBLIC_SITE_URL') ?? 'https://elo-peak.vercel.app').replace(/\/$/, '')

// Mesmo split de boosterEarningsShare() (ver src/lib/utils.ts) -- a
// mensagem vale pra todos os boosters de uma vez, então mostra a faixa
// (normal a top3) em vez de um valor fixo que só valeria pra alguns.
const BOOSTER_SHARE_NORMAL = 0.55
const BOOSTER_SHARE_TOP3   = 0.60
// Coaching não segue o split normal/top3 -- comissão fixa de 70% pro booster
// (mesma regra usada em trg_fn_order_completed_booster_stats, migration
// 20260824050000).
const BOOSTER_SHARE_COACHING = 0.70

// Mirrors LANE_LABEL/LANES em src/lib/lolTaxonomy.ts (não importável aqui --
// runtime Deno separado do bundle Vite, mesmo motivo pelo qual RANK_TIER_LABEL
// em discordRankFormat.ts também é duplicado em vez de importado).
const LANE_LABEL: Record<string, string> = {
  top: 'Top', jungle: 'Jungle', mid: 'Mid', bot: 'Adc', support: 'Sup',
}
const LANE_EMOJI: Record<string, string> = {
  top: '🗡️', jungle: '🌳', mid: '✨', bot: '🏹', support: '🛡️',
}
const LANE_KEYS = ['top', 'jungle', 'mid', 'bot', 'support']

// Cargo avisado em todo anúncio público (canal de jobs) -- só o cargo base
// "LoL Booster", nunca o de Top3 também: todo booster Top3 já tem o cargo
// base (não são exclusivos entre si), então mencionar os dois dava ping
// duplo pra quem é Top3. ID de cargo não é credencial, mesmo padrão de
// CHANNEL_TOP3 (discord-top3-announcement), hardcoded direto em vez de
// secret/env.
const BOOSTER_ROLE_IDS = ['1515483947029499904']

export async function fetchOrderProfiles(orderId: string) {
  const db = supabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select(`
      id, status, customer_id, assigned_booster_id, preferred_booster_id, exclusive_until,
      awaiting_assignment_announced_at,
      reassigned_by_admin, service_id, discord_voice_channel_id, discord_text_channel_id,
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
export function buildOrderFields(order: any) {
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
export function jobsButton(label: string) {
  return {
    type: 1,
    components: [{ type: 2, style: 5, label, url: `${APP_URL}/booster/jobs` }],
  }
}

// Anúncio público no canal de jobs -- pedidos SEM booster preferido entram
// aqui direto ao sair de awaiting_payment (discord-order-channel), e pedidos
// COM booster preferido entram aqui de novo quando a exclusividade expira
// sem aceite (announce-expired-exclusive-jobs) -- mesmo card nos dois casos,
// pra qualquer booster que olhe o canal reconhecer o mesmo formato de sempre.
// deno-lint-ignore no-explicit-any
export function buildPublicJobEmbed(order: any) {
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
// perfil público (reservados por 9h antes de caírem pro pool geral). Nos
// dois casos o pedido nem aparece no canal público de jobs -- ver
// buildPublicJobEmbed/awaiting_assignment. Reaproveitado por discord-order-
// channel (fluxo normal) e announce-stale-awaiting-assignment-jobs (retry
// quando o webhook falha antes de anunciar).
// deno-lint-ignore no-explicit-any
export function buildExclusiveJobDM(order: any) {
  const shortCode = String(order.id).slice(0, 8).toUpperCase()
  const isCoaching = order.service_type === 'coaching'
  // reassigned_by_admin vem de admin_reassign_booster -- admin escolheu esse
  // booster pra um pedido que já tinha dono ou estava parado no pool, em vez
  // de compra direta/coaching. Mesmo mecanismo de reserva (preferred_
  // booster_id + exclusive_until), mas título/cor própria pra não parecer
  // que o booster escolheu/comprou esse pedido -- espelha o card roxo
  // "Reatribuído" da aba Jobs (ver AvailableJobs.tsx).
  const isReassigned = !isCoaching && order.reassigned_by_admin === true
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

  const title = isCoaching
    ? '🎓 Novo Pedido de Coaching Reservado pra Você!'
    : isReassigned
      ? '🔄 Pedido Reatribuído pra Você!'
      : '🔒 Novo Pedido Reservado pra Você!'
  const description = isCoaching
    ? `Pedido #${shortCode} — esse pacote é exclusivamente seu.`
    : isReassigned
      ? `Pedido #${shortCode} — um administrador reatribuiu este pedido pra você. Só você pode aceitar por enquanto.`
      : `Pedido #${shortCode} — só você pode aceitar esse pedido por enquanto.`

  return {
    embeds: [{
      title,
      url: `${APP_URL}/booster/jobs`,
      description,
      // Roxo mais forte (0xA855F7) pro reatribuído, distinto do violeta do
      // exclusivo comum/coaching (0x8B5CF6) -- mesma ideia do rank-master
      // usado no card do site, cores diferentes por não compartilhar token
      // entre o design system do site e os embeds do Discord.
      color: isReassigned ? 0xA855F7 : 0x8B5CF6,
      fields,
      thumbnail: { url: cardThumbnailUrl(APP_URL, rankIconTier(order)) },
      footer: eloPeakFooter(APP_URL),
    }],
    components: [jobsButton('Ver na Aba Jobs')],
  }
}

// Cap curto e único retry em 429: sem isso, um envio limitado por taxa é
// logado e perdido pra sempre, já que todo chamador de sendChannelMessage/
// sendDirectMessage é um trigger de cron/webhook fire-and-forget sem caminho
// de retry próprio. Discord manda o tempo de espera tanto no header
// Retry-After quanto no corpo JSON (`retry_after`, em segundos, às vezes
// fracionário) -- tenta o header primeiro, cai pro corpo se ausente.
const MAX_DISCORD_RETRY_SECONDS = 5

async function fetchDiscordWithRetry(input: string, init: RequestInit): Promise<Response> {
  const res = await fetchWithTimeout(input, init)
  if (res.status !== 429) return res

  let retryAfterSeconds = Number(res.headers.get('retry-after'))
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    try {
      const body = await res.clone().json() as { retry_after?: number }
      retryAfterSeconds = Number(body.retry_after)
    } catch {
      retryAfterSeconds = 0
    }
  }
  retryAfterSeconds = Math.min(MAX_DISCORD_RETRY_SECONDS, Math.max(1, retryAfterSeconds || 1))
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000))
  return fetchWithTimeout(input, init)
}

export async function sendChannelMessage(channelId: string, payload: object) {
  const res = await fetchDiscordWithRetry(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error(`Discord send message failed ${res.status}:`, await res.text())
    throw new Error(`Discord send message ${res.status}`)
  }
}

// DM pra todo admin com Discord vinculado -- extraído de discord-admin-
// booster-alert/discord-admin-review-alert (mesmo lookup + loop de envio nos
// dois). Lança em caso de falha no lookup (o chamador decide o status/log);
// falha em DM de um admin específico não derruba os demais, só é logada com
// o prefixo de quem chamou.
export async function notifyAdmins(dm: object, logPrefix: string): Promise<number> {
  const db = supabaseAdmin()
  const { data: admins, error } = await db.from('profiles').select('discord_id').eq('role', 'admin').not('discord_id', 'is', null)
  if (error) throw new Error(error.message)

  let sent = 0
  for (const admin of (admins ?? []) as { discord_id: string | null }[]) {
    if (!admin.discord_id) continue
    try {
      await sendDirectMessage(admin.discord_id, dm)
      sent += 1
    } catch (err) {
      console.error(`${logPrefix}: failed to DM admin`, err instanceof Error ? err.message : err)
    }
  }
  return sent
}

// DM direto -- Discord exige abrir (ou reaproveitar) o canal de DM com o
// usuário antes de mandar qualquer mensagem direta (idempotente, sempre
// retorna o mesmo channel id pra um par bot/usuário). Extraído aqui em vez
// de duplicado entre discord-order-channel e discord-chat-mention.
export async function sendDirectMessage(discordUserId: string, payload: object) {
  const dmRes = await fetchDiscordWithRetry(`${DISCORD_API}/users/@me/channels`, {
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
