import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Order, OrderStatus, PaymentStatus, RankTier, BoosterStatus, OrderExtra } from '@/types'
import type { PayoutRequestStatus } from '@/api/payouts'

export { RANK_TIER_ORDER } from '../../shared/pricing'

// Tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Date formatting
export function formatDate(date: string | Date) {
  return format(new Date(date), 'dd MMM yyyy', { locale: ptBR })
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'dd MMM yyyy · HH:mm', { locale: ptBR })
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
}

// Prazo de entrega já vem multiplicado pelo backend (DELIVERY_ESTIMATE_MULTIPLIER
// em shared/pricing.ts) — só formata pra dias+horas quando passa de 24h.
export function formatEstimatedDelivery(hours: number): string {
  if (hours < 24) return `~${hours} hora${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  const remainingHours = Math.round(hours % 24)
  const daysLabel = `${days} dia${days === 1 ? '' : 's'}`
  return remainingHours > 0 ? `~${daysLabel} e ${remainingHours}h` : `~${daysLabel}`
}

// ─── Booster presence ─────────────────────────────────────────────────────────

// Sem toggle manual de "disponível/indisponível" -- continua puramente
// derivado de booster_profiles.last_active_at. "Online" aqui só significa
// "teve atividade nos últimos 5min", igual à antiga BOOSTER_PRESENCE_WINDOW_MS
// (removida no refactor a6de7db) -- não é um status setado pelo booster.
export const BOOSTER_PRESENCE_WINDOW_MS = 5 * 60_000

export function isBoosterOnline(lastActiveAt: string | null | undefined): boolean {
  if (!lastActiveAt) return false
  return Date.now() - new Date(lastActiveAt).getTime() < BOOSTER_PRESENCE_WINDOW_MS
}

export function formatLastSeen(lastActiveAt: string | null | undefined): string {
  if (!lastActiveAt) return 'Sem atividade registrada'
  return `Visto ${timeAgo(lastActiveAt)}`
}

// Só http(s) -- opgg_link vem direto do formulário do booster (texto livre),
// então valida o protocolo antes de jogar num href pra não abrir espaço pra
// um javascript:/data: URI malicioso.
export function safeOpggUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

// ─── Order status display ─────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  awaiting_payment: 'Aguardando Pagamento',
  paid: 'Pagamento Confirmado',
  awaiting_assignment: 'Esperando Booster',
  assigned: 'Booster Atribuído',
  in_progress: 'Em Andamento',
  paused: 'Pausado',
  drop_requested: 'Solicitação de Drop',
  awaiting_customer: 'Aguardando Cliente',
  completed: 'Concluído',
  disputed: 'Disputado',
  refunded: 'Reembolsado',
  canceled: 'Cancelado',
}

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  draft: 'text-ink-secondary bg-bg-elevated',
  awaiting_payment: 'text-warning bg-warning/10',
  paid: 'text-info bg-info/10',
  awaiting_assignment: 'text-info bg-info/10',
  assigned: 'text-brand bg-brand/10',
  in_progress: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  drop_requested: 'text-danger bg-danger/10',
  awaiting_customer: 'text-accent bg-accent/10',
  completed: 'text-success bg-success/10',
  disputed: 'text-danger bg-danger/10',
  refunded: 'text-ink-secondary bg-bg-elevated',
  canceled: 'text-ink-muted bg-bg-elevated',
}

// Agrupamento padronizado dos 13 status brutos em 6 grupos visíveis (mais
// "hidden" pra canceled/refunded/disputed, que nunca aparece agrupado --
// ver getOrderStatusGroup). É a única fonte de verdade usada pelas abas de
// filtro (Todos/Em andamento/Concluído) e pelo badge de status em toda a UI,
// substituindo o agrupamento duplicado/divergente que cada tela tinha antes.
export type OrderStatusGroup =
  | 'awaiting_payment'
  | 'awaiting_booster'
  | 'awaiting_credentials'
  | 'in_progress'
  | 'drop_requested'
  | 'completed'
  | 'hidden'

// awaiting_customer é o único status reaproveitado pra dois momentos bem
// diferentes do pedido: antes de assigned_booster_id existir, é o cliente
// enviando login/senha (aguardando credenciais) pra liberar o pedido pro
// pool; depois, é o booster pedindo confirmação/ação do cliente em pleno
// andamento. assigned_booster_id é o único jeito de diferenciar os dois.
export function getOrderStatusGroup(order: Pick<Order, 'status' | 'assigned_booster_id'>): OrderStatusGroup {
  switch (order.status) {
    case 'draft':
    case 'awaiting_payment':
      return 'awaiting_payment'
    case 'paid':
    case 'awaiting_assignment':
      return 'awaiting_booster'
    case 'awaiting_customer':
      return order.assigned_booster_id ? 'in_progress' : 'awaiting_credentials'
    case 'assigned':
    case 'in_progress':
    case 'paused':
      return 'in_progress'
    case 'drop_requested':
      return 'drop_requested'
    case 'completed':
      return 'completed'
    case 'disputed':
    case 'refunded':
    case 'canceled':
      return 'hidden'
  }
}

export const ORDER_STATUS_GROUP_LABEL: Record<OrderStatusGroup, string> = {
  awaiting_payment: 'Aguardando Pagamento',
  awaiting_booster: 'Aguardando Booster',
  awaiting_credentials: 'Aguardando Credenciais',
  in_progress: 'Em Andamento',
  drop_requested: 'Solicitação de Drop',
  completed: 'Concluído',
  hidden: 'Cancelado',
}

export const ORDER_STATUS_GROUP_COLOR: Record<OrderStatusGroup, string> = {
  awaiting_payment: 'text-warning bg-warning/10',
  awaiting_booster: 'text-info bg-info/10',
  awaiting_credentials: 'text-accent bg-accent/10',
  in_progress: 'text-success bg-success/10',
  drop_requested: 'text-danger bg-danger/10',
  completed: 'text-success bg-success/10',
  hidden: 'text-ink-muted bg-bg-elevated',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Reembolsado',
  partially_refunded: 'Parcialmente reembolsado',
  disputed: 'Em disputa',
}

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  pending: 'text-warning bg-warning/10 border-warning/20',
  paid: 'text-success bg-success/10 border-success/20',
  failed: 'text-danger bg-danger/10 border-danger/20',
  refunded: 'text-ink-secondary bg-bg-elevated border-bg-elevated',
  partially_refunded: 'text-ink-secondary bg-bg-elevated border-bg-elevated',
  disputed: 'text-danger bg-danger/10 border-danger/20',
}

// ─── Rank display ─────────────────────────────────────────────────────────────

export const RANK_TIER_COLOR: Record<RankTier, string> = {
  iron: 'text-rank-iron',
  bronze: 'text-rank-bronze',
  silver: 'text-rank-silver',
  gold: 'text-rank-gold',
  platinum: 'text-rank-platinum',
  emerald: 'text-rank-emerald',
  diamond: 'text-rank-diamond',
  master: 'text-rank-master',
  grandmaster: 'text-rank-grandmaster',
  challenger: 'text-rank-challenger',
}

export const RANK_TIER_LABEL: Record<RankTier, string> = {
  iron: 'Ferro',
  bronze: 'Bronze',
  silver: 'Prata',
  gold: 'Ouro',
  platinum: 'Platina',
  emerald: 'Esmeralda',
  diamond: 'Diamante',
  master: 'Mestre',
  grandmaster: 'Grão-mestre',
  challenger: 'Desafiante',
}

export function formatRank(tier: RankTier, division?: string | null) {
  const tierLabel = RANK_TIER_LABEL[tier]
  if (!division || ['master', 'grandmaster', 'challenger'].includes(tier)) return tierLabel
  return `${tierLabel} ${division}`
}

// Ordena o snapshot de extras gravado no pedido pela posição travada na
// criação (sort_order) — nunca pela ordem em que veio do banco/array.
// Pedidos antigos (sem sort_order) caem no fim, na ordem em que já
// estavam, sem quebrar a exibição.
export function sortOrderExtras(extras: OrderExtra[]): OrderExtra[] {
  return [...extras].sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
}

// ─── Booster status ───────────────────────────────────────────────────────────

export const BOOSTER_STATUS_LABEL: Record<BoosterStatus, string> = {
  pending: 'Pendente',
  under_review: 'Em Revisão',
  approved: 'Aprovado',
  suspended: 'Suspenso',
  rejected: 'Rejeitado',
  removed: 'Expulso',
}

export const BOOSTER_STATUS_COLOR: Record<BoosterStatus, string> = {
  pending: 'text-warning bg-warning/10',
  under_review: 'text-info bg-info/10',
  approved: 'text-success bg-success/10',
  suspended: 'text-danger bg-danger/10',
  rejected: 'text-ink-muted bg-bg-elevated',
  removed: 'text-ink-muted bg-bg-elevated',
}

// ─── Payout request status ──────────────────────────────────────────────────
// Fonte única -- antes duplicado (e já divergente) entre as telas de admin e
// de booster; mantém os 3 estados de "aguardando" distintos, já que a versão
// mais granular (usada antes só pelo booster) nunca perde informação pro
// admin, e é o admin quem mais se beneficia de saber se algo já está em
// revisão vs. só acabou de ser pedido.
export const PAYOUT_REQUEST_STATUS_LABEL: Record<PayoutRequestStatus, string> = {
  requested: 'Aguardando análise',
  under_review: 'Em revisão',
  approved: 'Aprovado — a pagar',
  paid: 'Pago',
  rejected: 'Rejeitado',
  canceled: 'Cancelado',
}

export const PAYOUT_REQUEST_STATUS_COLOR: Record<PayoutRequestStatus, string> = {
  requested: 'text-warning bg-warning/10',
  under_review: 'text-info bg-info/10',
  approved: 'text-brand bg-brand/10',
  paid: 'text-success bg-success/10',
  rejected: 'text-danger bg-danger/10',
  canceled: 'text-ink-muted bg-bg-elevated',
}

// ─── Service label ────────────────────────────────────────────────────────────

// 4 serviços canônicos da plataforma -- win_boost, md5 e o legado
// placement_matches são todos variações de "compra de vitórias", por isso
// caem juntos em "Wins" (mesmo agrupamento que ServiceFilterBar já usa pra
// filtrar os 3 debaixo de uma categoria só).
const SERVICE_LABEL_MAP: Record<string, string> = {
  elo_boost:         'Elo Boost',
  win_boost:         'Wins',
  md5:               'Wins',
  placement_matches: 'Wins',
  coaching:          'Coaching',
  clash:             'Clash',
}

// Nome do serviço pra título de card/campo "Serviço" na página de detalhe --
// sempre um dos 4 nomes canônicos acima, independente do modo (solo/duo) do
// pedido (isso é o campo/rótulo "Modo", ver getOrderModeType).
export function getServiceLabel(serviceId: string | null | undefined): string {
  if (!serviceId) return '—'
  return SERVICE_LABEL_MAP[serviceId] ?? serviceId.replace(/_/g, ' ')
}

// Mesma coisa que getServiceLabel, só que recebendo o pedido inteiro (mais
// conveniente nos cards/detalhes que já têm o objeto order/job em mãos).
export function getOrderServiceName(order: Pick<Order, 'service_type'>): string {
  return getServiceLabel(order.service_type)
}

// Modo do pedido -- só "Solo" ou "Duo", sem repetir o nome do serviço (que já
// aparece em getOrderServiceName/getServiceLabel). Só chamado onde o pedido
// de fato tem essa variação (elo_boost, win_boost/md5, clash), nunca coaching.
export function getOrderModeType(order: Pick<Order, 'boost_mode'>): string {
  return order.boost_mode === 'duo' ? 'Duo' : 'Solo'
}

// Mirrors public.order_requires_access_token(service_type, boost_mode) —
// mantém a mesma predicate no front pra decidir quando mostrar a seção de
// credenciais da conta, sem duplicar a regra em cada tela. Duo nunca entra
// aqui: pedidos duo usam a conta duo da empresa (DuoAccountSection), o
// cliente nunca gera/fornece as próprias credenciais.
export function orderRequiresAccountAccess(order: Pick<Order, 'service_type' | 'boost_mode'>): boolean {
  return (
    (order.boost_mode ?? "solo") === "solo" &&
    (order.service_type === "elo_boost" ||
      order.service_type === "win_boost" ||
      order.service_type === "md5" ||
      order.service_type === "clash")
  );
}

// Regra de disponibilidade do histórico de partidas (OrderMatchHistory),
// compartilhada pelas telas de cliente, booster e admin -- started reflete
// se o booster já iniciou o sync (match_sync_started_at setado); syncable
// reflete se o status do pedido ainda permite ressincronizar manualmente.
export function getOrderMatchSyncGate(order: Pick<Order, 'match_sync_started_at' | 'status'>): { started: boolean; syncable: boolean } {
  return {
    started: !!order.match_sync_started_at,
    syncable: ['in_progress', 'paused', 'drop_requested'].includes(order.status),
  }
}

// Share of order.total_price the booster receives before an authoritative
// payout_records row exists (mirrors trg_fn_order_completed_booster_stats,
// migration 069): 55% normally, 60% for Top3 boosters.
export const BOOSTER_EARNINGS_SHARE_NORMAL = 0.55
export const BOOSTER_EARNINGS_SHARE_TOP3 = 0.60

export function boosterEarningsShare(isTop3?: boolean | null): number {
  return isTop3 ? BOOSTER_EARNINGS_SHARE_TOP3 : BOOSTER_EARNINGS_SHARE_NORMAL
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Usado para distinguir um uuid real de catálogo (games.id/services.id) de um
// slug/tipo cru (ex.: 'lol', 'win_boost') que ainda não foi resolvido — ver
// OrderBuilder.tsx/StepPayment.tsx.
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}
