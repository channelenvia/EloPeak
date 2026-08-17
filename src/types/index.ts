// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'booster' | 'admin'

export type BoostMode = 'solo' | 'duo'

export type GameSlug = 'lol' | 'valorant' | 'tft'

export type ServiceType =
  | 'elo_boost'
  | 'win_boost'
  | 'coaching'
  | 'placement_matches'
  | 'md5'
  | 'clash'

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

export type BoosterStatus = 'pending' | 'under_review' | 'approved' | 'suspended' | 'rejected' | 'removed'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'

export type NotificationType =
  | 'order_status_changed'
  | 'order_assigned'
  | 'order_completed'
  | 'message_received'
  | 'ticket_updated'
  | 'payment_confirmed'
  | 'review_received'
  | 'booster_approved'
  | 'exclusive_job'
  | 'chat_mention'
  | 'payout_request_created'
  | 'payout_request_paid'
  | 'payout_request_rejected'
  | 'commission_clawed_back'
  | 'commission_clawed_back_admin'
  | 'drop_penalty_applied'
  | 'drop_payout_credited'
  | 'payment_amount_mismatch'
  | 'order_reassigned'
  | 'order_dropped_by_admin'
  | 'customer_requested_drop'
  | 'drop_fee_applied'
  | 'drop_warning_issued'
  | 'booster_temporarily_blocked'
  | 'booster_auto_suspended'
  | 'drop_penalty_waived'

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
  discord_id: string | null
  terms_accepted_at: string | null
  privacy_accepted_at: string | null
  legal_version: string | null
  created_at: string
  updated_at: string
}

export interface BoosterProfile {
  id: string
  user_id: string
  display_name: string
  display_name_changed_at: string | null
  avatar_url: string | null
  status: BoosterStatus
  bio: string | null
  peak_rank: Rank | null
  current_rank: Rank | null
  total_completed: number
  total_earnings: number
  rating: number
  rating_count: number
  games: string[]
  is_top3: boolean
  opgg_link: string | null
  hours_per_day_min: number | null
  hours_per_day_max: number | null
  full_name: string | null
  email: string | null
  cpf: string | null
  lanes: string[] | null
  specialties: string[] | null
  can_coach: boolean | null
  available_days: string[] | null
  verified_at: string | null
  last_active_at: string | null
  blocked_until: string | null
  suspended_until: string | null
  created_at: string
  updated_at: string
}

// Nota interna do admin sobre um booster -- nunca visível pro próprio
// booster, tabela própria (booster_admin_notes) com RLS admin-only.
export interface BoosterAdminNote {
  booster_id: string
  note: string
  updated_at: string
  updated_by: string | null
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

// Fluxo do configurador de boost ao qual um addon pertence. null = extra
// legado (pré-reforma), mantido só para exibição de pedidos antigos —
// nunca oferecido no configurador atual.
export type BoostFlow = 'solo_standard' | 'duo_standard' | 'master_plus'

export type ClashTier = 'tier_4' | 'tier_3' | 'tier_2' | 'tier_1'
export type ClashDay = 'saturday' | 'sunday'

export interface ServiceExtra {
  id: string
  service_id: string | null  // null = applies to all
  name: string
  description: string
  price_modifier: number       // flat BRL
  price_modifier_pct: number   // % of base price
  is_active: boolean
  sort_order: number
  icon: string | null
  flow: BoostFlow | null
  code: string | null          // identificador estável — nunca o label
  // Sobrescrita de name/description por service_type (ver resolveAddonLabel
  // em shared/boostDomain.ts) — o mesmo addon é compartilhado por vários
  // service_types dentro de um flow (ex.: solo_standard serve Elo Boost
  // Solo/Vitórias/MD5/Solo Clash), então o texto base sozinho nem sempre
  // faz sentido pra todos eles.
  service_type_overrides: Partial<Record<ServiceType, { name?: string; description?: string }>> | null
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface OrderExtra {
  extra_id: string
  name: string
  price: number
  // Campos novos (pedidos criados após a reforma do configurador) — podem
  // ser undefined em pedidos antigos, que só tinham extra_id/name/price.
  code?: string
  percentage?: number
  // Posição de exibição travada no momento da criação do pedido — não
  // depende de reconsultar service_extras (que pode mudar depois). Acesso
  // Prioritário é sempre o maior valor aqui.
  sort_order?: number
}

export interface Order {
  id: string
  customer_id: string
  service_id: string
  // Denormalized at creation time from services.type — service_id is a
  // uuid (services.id), never compare it directly against a ServiceType slug.
  service_type: ServiceType
  game_id: string
  status: OrderStatus
  queue_type: QueueType
  boost_mode: BoostMode
  server: string
  current_rank: Rank | null
  target_rank: Rank | null
  // Clash: tier fixo escolhido (não um rank+divisão) e dia agendado — null
  // para qualquer outro service_type.
  clash_tier: ClashTier | null
  clash_day: ClashDay | null
  wins_purchased: number | null       // for win boost
  sessions_purchased: number | null   // for coaching
  extras: OrderExtra[]
  base_price: number
  extras_price: number
  total_price: number
  // Cupom fixo aplicado automaticamente no configurador (shared/pricing.ts,
  // DEFAULT_COUPON_CODE) — coupon_code é só o código informativo/auditoria,
  // discount_price é o valor em R$ já abatido do subtotal (total_price já
  // reflete o desconto, nunca precisa ser recalculado no cliente).
  coupon_code: string | null
  discount_price: number
  estimated_hours: number | null
  customer_notes: string | null
  booster_notes: string | null
  wins_played: number
  losses_played: number
  assigned_booster_id: string | null
  chat_locked: boolean
  chat_locked_by: string | null
  chat_locked_at: string | null
  mp_payment_id: string | null
  payment_status: PaymentStatus | null
  credentials_set: boolean
  credential_expires_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Boost Master+ — null para pedidos que não são Master+ (Solo/Duo padrão
  // não têm PDL atual/médias; ver shared/boostDomain.ts).
  current_pdl: number | null
  pdl_bracket: '0_49' | '50_89' | '90_119' | '120_plus' | null
  avg_pdl_gain: number | null
  avg_pdl_loss: number | null
  pricing_version: string
  // Pedido direto: booster escolhido no perfil público antes do pagamento.
  // exclusive_until é setado só quando o pagamento é confirmado — enquanto
  // estiver no futuro, o pedido só aparece para esse booster no pool.
  preferred_booster_id: string | null
  exclusive_until: string | null
  // Riot ID (nome#tag) usado pra verificar automaticamente se o rank alvo
  // foi atingido — só coletado em fluxos que têm target_rank (elo_boost).
  riot_id: string | null
  // Riot ID da "conta própria" do booster pra Duo Boost -- alternativa à
  // conta reservada em duo_accounts (pool da plataforma). Só faz sentido
  // quando boost_mode === 'duo'; sem token de acesso porque é a própria
  // conta do booster, ele já tem login.
  duo_own_riot_id: string | null
  // Pacote de coach comprado (booster_services.id) — só setado quando
  // service_type === 'coaching'.
  booster_service_id: string | null
  // Início real do boost (primeira transição pra in_progress) — janela a
  // partir da qual sync-order-matches contabiliza partidas; também usado
  // como início do prazo estimado (CountdownTimer).
  match_sync_started_at: string | null
  last_match_synced_at: string | null
  // Disclaimer de drop: drop_count > 0 sinaliza que este pedido já foi
  // reaberto por um drop antes. rank_before_last_drop é o current_rank
  // (só elo_boost) tirado logo antes do último drop sobrescrevê-lo com o
  // rank verificado mais recente -- mostra o progresso que o booster
  // anterior entregou, além do current_rank -> target_rank já existente.
  drop_count: number
  rank_before_last_drop: Rank | null
  last_dropped_at: string | null
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

export interface OrderRankVerification {
  id: string
  order_id: string
  requested_by: string
  riot_id_checked: string
  fetched_tier: RankTier | null
  fetched_division: Division | null
  fetched_lp: number | null
  target_tier: RankTier
  target_division: Division | null
  passed: boolean
  error_reason: string | null
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
  requested_by_role: 'booster' | 'admin' | 'customer'
  status_at_request: OrderStatus | null
  penalty_bucket: 'heavy_loss' | 'light_loss' | 'tied_or_winning' | null
  penalty_fee_pct: number | null
  penalty_fee_amount: number | null
  warning_issued: boolean
  waived_by: string | null
  waived_at: string | null
}

export interface OrderMatch {
  id: string
  order_id: string
  external_match_id: string
  result: 'win' | 'loss'
  champion: string | null
  kills: number
  deaths: number
  assists: number
  queue_id: number | null
  duration_seconds: number | null
  played_at: string
  created_at: string
  minions_killed: number | null
  neutral_minions_killed: number | null
  is_mvp: boolean
}

/** Mesmo shape de OrderMatch + booster_id -- partidas jogadas na conta duo do booster (booster_duo_matches), separado de OrderMatch (sempre a conta do cliente). */
export interface BoosterDuoMatch extends OrderMatch {
  booster_id: string
}

export interface OrderCoachingTopic {
  id: string
  order_id: string
  content: string
  is_done: boolean
  created_by: string
  created_by_role: 'customer' | 'booster' | 'admin'
  completed_by: string | null
  completed_at: string | null
  created_at: string
}

export interface OrderChatMessage {
  id: string
  order_id: string
  sender_id: string
  sender_role: UserRole
  sender_name: string
  sender_avatar_url: string | null
  content: string
  created_at: string
  is_read: boolean
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
  payment_id: string | null
  order_id: string
  mp_refund_id: string | null
  amount: number
  reason: string
  initiated_by: string
  status: 'pending' | 'succeeded' | 'failed'
  /** true = admin registrou manualmente (PIX manual, fora do Mercado Pago). */
  is_manual: boolean
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

// ─── Booster Services ─────────────────────────────────────────────────────────

export interface BoosterService {
  id: string
  booster_id: string
  title: string
  description: string | null
  tempo: string | null
  price: number
  service_type: string | null
  unit: string
  requirements: string | null
  availability_note: string | null
  is_active: boolean
  rules: string | null
  // Pacotes de coach: até 2 lanes de um vocabulário fixo (src/lib/lolTaxonomy.ts)
  // — null pra registros antigos não-coaching. Especialidades combinam o
  // mesmo vocabulário fixo com texto livre do booster (até 5 no total).
  // Champions: texto livre do booster, sem taxonomia fixa (até 3).
  lanes: string[] | null
  specialties: string[] | null
  champions: string[] | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
