-- Delivery estimates are calculated from 30-minute matches, so valid values
-- include half-hours (for example 2.5). The original integer column rejected
-- the whole order insert whenever the estimate was fractional.
drop view public.available_boost_orders;

alter table public.orders
  alter column estimated_hours type numeric(8,2)
  using estimated_hours::numeric(8,2);

comment on column public.orders.estimated_hours is
  'Server-calculated estimated delivery duration in hours; supports fractional hours.';

-- Recreate the same security-filtered booster projection after the type
-- change. Dropping it first is required because PostgreSQL views bind to the
-- source column type.
create view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
