// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'booster' | 'admin' | 'support'

export type BoostMode = 'solo' | 'duo'

export type GameSlug = 'lol' | 'valorant' | 'tft'

export type ServiceType =
  | 'elo_boost'
  | 'win_boost'
  | 'coaching'
  | 'placement_matches'
  | 'md5'

export type QueueType = 'solo_duo' | 'flex'

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'paid'
  | 'awaiting_assignment'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'drop_requested'
  | 'awaiting_customer'
  | 'completed'
  | 'disputed'
  | 'refunded'
  | 'canceled'

export type BoosterStatus = 'pending' | 'under_review' | 'approved' | 'suspended' | 'rejected'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export type NotificationType =
  | 'order_status_changed'
  | 'order_assigned'
  | 'order_completed'
  | 'message_received'
  | 'ticket_updated'
  | 'payment_confirmed'
  | 'review_received'
  | 'booster_approved'

// ─── Rank / Tier system ───────────────────────────────────────────────────────

export type RankTier =
  | 'iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'emerald'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'challenger'

export type Division = 'I' | 'II' | 'III' | 'IV'

export interface Rank {
  tier: RankTier
  division: Division | null  // null for Master+
  lp?: number
}

// ─── User / Profile ───────────────────────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  role: UserRole
  username: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface CustomerProfile {
  id: string
  user_id: string
  display_name: string | null
  country: string | null
  preferred_language: string | null
  total_orders: number
  total_spent: number
  created_at: string
}

export interface BoosterProfile {
  id: string
  user_id: string
  display_name: string
  status: BoosterStatus
  bio: string | null
  peak_rank: Rank | null
  current_rank: Rank | null
  total_completed: number
  total_earnings: number
  rating: number
  rating_count: number
  games: string[]
  is_available: boolean
  is_top5: boolean
  opgg_link: string | null
  hours_per_day_min: number | null
  hours_per_day_max: number | null
  full_name: string | null
  email: string | null
  cpf: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export interface Game {
  id: string
  slug: GameSlug
  name: string
  icon_url: string | null
  is_active: boolean
  sort_order: number
}

export interface Service {
  id: string
  game_id: string
  type: ServiceType
  name: string
  description: string | null
  short_description: string | null
  is_active: boolean
  sort_order: number
}

export interface ServiceExtra {
  id: string
  service_id: string | null  // null = applies to all
  name: string
  description: string
  price_modifier: number       // flat USD
  price_modifier_pct: number   // % of base price
  is_active: boolean
  sort_order: number
  icon: string | null
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface OrderExtra {
  extra_id: string
  name: string
  price: number
}

export interface Order {
  id: string
  customer_id: string
  service_id: string
  game_id: string
  status: OrderStatus
  queue_type: QueueType
  boost_mode: BoostMode
  server: string
  current_rank: Rank
  target_rank: Rank | null
  wins_purchased: number | null       // for win boost
  sessions_purchased: number | null   // for coaching
  extras: OrderExtra[]
  base_price: number
  extras_price: number
  total_price: number
  estimated_hours: number | null
  customer_notes: string | null
  booster_notes: string | null
  wins_played: number
  losses_played: number
  assigned_booster_id: string | null
  mp_payment_id: string | null
  payment_status: PaymentStatus | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface OrderStatusHistory {
  id: string
  order_id: string
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_by: string
  reason: string | null
  created_at: string
}

export interface OrderDropRequest {
  id: string
  order_id: string
  booster_id: string
  reason: string
  wins_at_request: number
  losses_at_request: number
  penalty_pct: number
  penalty_amount: number
  status: 'pending' | 'approved' | 'rejected'
  admin_id: string | null
  admin_note: string | null
  created_at: string
  resolved_at: string | null
}

export interface OrderMessage {
  id: string
  order_id: string
  sender_id: string
  sender_role: UserRole
  content: string
  attachment_url: string | null
  is_read: boolean
  created_at: string
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface Payment {
  id: string
  order_id: string
  customer_id: string
  mp_payment_id: string
  amount: number
  currency: string
  status: PaymentStatus
  payment_method_type: string | null
  webhook_event_id: string | null
  refunded_amount: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Refund {
  id: string
  payment_id: string
  order_id: string
  mp_refund_id: string
  amount: number
  reason: string
  initiated_by: string
  status: 'pending' | 'succeeded' | 'failed'
  created_at: string
}

// ─── Support ──────────────────────────────────────────────────────────────────

export interface SupportTicket {
  id: string
  customer_id: string
  order_id: string | null
  assigned_to: string | null
  status: TicketStatus
  priority: TicketPriority
  subject: string
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface TicketMessage {
  id: string
  ticket_id: string
  sender_id: string
  sender_role: UserRole
  content: string
  is_internal: boolean  // internal admin note
  attachment_url: string | null
  created_at: string
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export interface Review {
  id: string
  order_id: string
  customer_id: string
  booster_id: string | null
  rating: number  // 1-5
  content: string | null
  is_public: boolean
  is_moderated: boolean
  admin_note: string | null
  created_at: string
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string
  actor_id: string
  actor_role: UserRole
  action: string
  entity_type: string
  entity_id: string
  diff: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export interface PayoutRecord {
  id: string
  booster_id: string
  order_id: string
  gross_amount: number
  commission_rate: number
  commission_amount: number
  net_amount: number
  status: 'pending' | 'processing' | 'paid' | 'failed'
  paid_at: string | null
  created_at: string
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export interface SelectOption<T = string> {
  label: string
  value: T
  description?: string
  disabled?: boolean
  icon?: React.ReactNode
}

export interface TableColumn<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
  align?: 'left' | 'center' | 'right'
}

export type SortDirection = 'asc' | 'desc'

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ApiError {
  message: string
  code?: string
  status?: number
}
