// Projeção compartilhada das colunas de pedido liberadas ao cliente pelo
// backend. Nunca use select('*') em public.orders: game_credentials contém o
// payload criptografado e não possui grant para sessões do navegador.
export const ORDER_SAFE_COLUMNS = [
  'id', 'customer_id', 'service_id', 'service_type', 'game_id', 'booster_service_id',
  'assigned_booster_id', 'status', 'queue_type', 'boost_mode', 'server',
  'current_rank', 'target_rank', 'wins_purchased', 'sessions_purchased', 'win_package',
  'extras', 'base_price', 'extras_price', 'total_price', 'estimated_hours',
  'customer_notes', 'booster_notes', 'payment_status', 'credentials_set',
  'credential_expires_at', 'wins_played', 'losses_played', 'completed_at',
  'created_at', 'updated_at', 'current_pdl', 'pdl_bracket', 'avg_pdl_gain',
  'avg_pdl_loss', 'pricing_version', 'mp_payment_id', 'riot_id',
  'preferred_booster_id', 'exclusive_until', 'md5_matches_remaining',
  'chat_locked', 'chat_locked_at', 'chat_locked_by',
  'match_sync_started_at', 'last_match_synced_at',
  'coupon_code', 'discount_price', 'clash_tier', 'clash_day',
  'drop_count', 'rank_before_last_drop', 'last_dropped_at', 'duo_own_riot_id',
].join(',')
