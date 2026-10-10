-- Aviso de "elo informado pelo cliente" tambem para o booster que ve o job no pool (coluna nova ao final da view).
create or replace view public.available_boost_orders as
 SELECT id,
    service_id,
    game_id,
    status,
    queue_type,
    boost_mode,
    server,
    current_rank,
    target_rank,
    wins_purchased,
    sessions_purchased,
    win_package,
    extras,
    total_price,
    estimated_hours,
    wins_played,
    losses_played,
    current_pdl,
    pdl_bracket,
    avg_pdl_gain,
    avg_pdl_loss,
    pricing_version,
    created_at,
    updated_at,
    preferred_booster_id,
    exclusive_until,
    drop_count,
    rank_before_last_drop,
    last_dropped_at,
    service_type,
    clash_tier,
    clash_day,
    customer_lanes,
    booster_service_id,
    reassigned_by_admin,
    rank_source
   FROM orders
  WHERE status = 'awaiting_assignment'::order_status AND assigned_booster_id IS NULL AND is_approved_booster() AND (NOT order_requires_access_token(service_type, boost_mode) OR credentials_set = true) AND
        CASE
            WHEN service_type = 'coaching'::service_type THEN preferred_booster_id = auth.uid()
            ELSE preferred_booster_id IS NULL OR exclusive_until IS NULL OR exclusive_until <= now() OR preferred_booster_id = auth.uid()
        END AND (preferred_booster_id = auth.uid() OR NOT (EXISTS ( SELECT 1
           FROM order_drop_requests dr
          WHERE dr.order_id = orders.id AND dr.booster_id = auth.uid() AND dr.status = 'approved'::text)));
alter view public.available_boost_orders set (security_barrier = true);
