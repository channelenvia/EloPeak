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
  draft: 'text-ink-secondary bg-bg-overlay',
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
  refunded: 'text-ink-secondary bg-bg-overlay',
  canceled: 'text-ink-muted bg-bg-overlay',
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
  refunded: 'text-ink-secondary bg-bg-elevated border-bg-overlay',
  partially_refunded: 'text-ink-secondary bg-bg-elevated border-bg-overlay',
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
  rejected: 'text-ink-muted bg-bg-overlay',
  removed: 'text-ink-muted bg-bg-overlay',
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

const SERVICE_LABEL_MAP: Record<string, string> = {
  elo_boost:         'Solo Boost / Duo Boost',
  win_boost:         'Vitórias / MD5',
  placement_matches: 'MD5 Completo (legado)',
  coaching:          'Coaching',
  md5:               'Vitórias / MD5',
  clash:             'Clash',
}

export function getServiceLabel(serviceId: string | null | undefined): string {
  if (!serviceId) return '—'
  return SERVICE_LABEL_MAP[serviceId] ?? serviceId.replace(/_/g, ' ')
}

// Rótulo específico dentro da categoria de getServiceLabel -- "Solo Boost /
// Duo Boost" (elo_boost) vira "Solo Boost" ou "Duo Boost"; "Vitórias / MD5"
// vira "Vitórias" ou "MD5". Usado nos cards/detalhes de pedido do booster
// pra deixar claro exatamente qual variação é o pedido, não só a categoria.
export function getOrderModeType(order: Pick<Order, 'service_type' | 'boost_mode'>): string {
  if (!order.service_type) return '—'
  if (order.service_type === 'elo_boost') return order.boost_mode === 'duo' ? 'Duo Boost' : 'Solo Boost'
  if (order.service_type === 'win_boost') return order.boost_mode === 'duo' ? 'Duo Vitórias' : 'Vitórias'
  if (order.service_type === 'md5') return order.boost_mode === 'duo' ? 'Duo MD5' : 'MD5'
  if (order.service_type === 'coaching') return 'Coaching'
  if (order.service_type === 'placement_matches') return 'MD5 Completo'
  if (order.service_type === 'clash') return order.boost_mode === 'duo' ? 'Duo Clash' : 'Solo Clash'
  return getServiceLabel(order.service_type)
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
