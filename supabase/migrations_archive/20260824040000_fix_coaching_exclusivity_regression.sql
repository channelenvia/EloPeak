-- Regressão: a migration 20260824010000 (customer_lanes) recriou
-- available_boost_orders a partir de uma versão desatualizada da view --
-- sem querer, derrubou o branch "coaching é sempre exclusivo do booster
-- dono do pacote" que a migration 20260814050000_coaching_permanent_exclusivity
-- tinha adicionado (case when service_type='coaching' then
-- preferred_booster_id = auth.uid()). Como coaching sempre tem
-- exclusive_until = null (process_mp_payment_event nunca seta prazo pra
-- coaching, a exclusividade é permanente por design), a cláusula genérica
-- "... or exclusive_until is null or ..." reabriu pra QUALQUER booster
-- aprovado -- pedidos de coaching vazando pro pool geral de novo, o mesmo
-- bug que a 20260814050000 existia pra corrigir. Restaura o branch,
-- mantendo customer_lanes no select (única mudança real pretendida na
-- 20260824010000).
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type,
  clash_tier, clash_day, customer_lanes
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    case
      when service_type = 'coaching' then preferred_booster_id = auth.uid()
      else preferred_booster_id is null
        or exclusive_until is null
        or exclusive_until <= now()
        or preferred_booster_id = auth.uid()
    end
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  )
  and not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = auth.uid() and bp.blocked_until is not null and bp.blocked_until > now()
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
