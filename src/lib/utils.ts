import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'
import type { OrderStatus, RankTier, TicketStatus, TicketPriority, BoosterStatus } from '@/types'

// Tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Date formatting
export function formatDate(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy · h:mm a')
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

// ─── Order status display ─────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  awaiting_payment: 'Awaiting Payment',
  paid: 'Payment Confirmed',
  awaiting_assignment: 'Queued',
  assigned: 'Booster Assigned',
  in_progress: 'In Progress',
  paused: 'Paused',
  drop_requested: 'Drop Requested',
  awaiting_customer: 'Awaiting You',
  completed: 'Completed',
  disputed: 'Disputed',
  refunded: 'Refunded',
  canceled: 'Canceled',
}

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  draft: 'text-ink-secondary bg-bg-overlay',
  awaiting_payment: 'text-warning bg-warning/10',
  paid: 'text-info bg-info/10',
  awaiting_assignment: 'text-info bg-info/10',
  assigned: 'text-brand bg-brand-muted',
  in_progress: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  drop_requested: 'text-danger bg-danger/10',
  awaiting_customer: 'text-accent bg-accent/10',
  completed: 'text-success bg-success/10',
  disputed: 'text-danger bg-danger/10',
  refunded: 'text-ink-secondary bg-bg-overlay',
  canceled: 'text-ink-muted bg-bg-overlay',
}

// ─── Rank display ─────────────────────────────────────────────────────────────

export const RANK_TIER_ORDER: RankTier[] = [
  'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger',
]

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
  iron: 'Iron',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  emerald: 'Emerald',
  diamond: 'Diamond',
  master: 'Master',
  grandmaster: 'Grandmaster',
  challenger: 'Challenger',
}

export function formatRank(tier: RankTier, division?: string | null) {
  const tierLabel = RANK_TIER_LABEL[tier]
  if (!division || ['master', 'grandmaster', 'challenger'].includes(tier)) return tierLabel
  return `${tierLabel} ${division}`
}

// ─── Booster status ───────────────────────────────────────────────────────────

export const BOOSTER_STATUS_LABEL: Record<BoosterStatus, string> = {
  pending: 'Pending',
  under_review: 'Under Review',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
}

export const BOOSTER_STATUS_COLOR: Record<BoosterStatus, string> = {
  pending: 'text-warning bg-warning/10',
  under_review: 'text-info bg-info/10',
  approved: 'text-success bg-success/10',
  suspended: 'text-danger bg-danger/10',
  rejected: 'text-ink-muted bg-bg-overlay',
}

// ─── Ticket status ────────────────────────────────────────────────────────────

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting for You',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const TICKET_STATUS_COLOR: Record<TicketStatus, string> = {
  open: 'text-danger bg-danger/10',
  in_progress: 'text-brand bg-brand-muted',
  waiting_customer: 'text-accent bg-accent/10',
  resolved: 'text-success bg-success/10',
  closed: 'text-ink-muted bg-bg-overlay',
}

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const TICKET_PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: 'text-ink-secondary',
  medium: 'text-warning',
  high: 'text-danger',
  urgent: 'text-danger font-bold',
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function truncate(str: string, length = 50) {
  if (str.length <= length) return str
  return str.slice(0, length).trimEnd() + '…'
}

export function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

