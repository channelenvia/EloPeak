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
      id, status, customer_id, assigned_booster_id, preferred_booster_id, exclusive_until, reassigned_by_admin,
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

export async function sendChannelMessage(channelId: string, payload: object) {
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
