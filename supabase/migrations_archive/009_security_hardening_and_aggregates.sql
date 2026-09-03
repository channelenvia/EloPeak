-- ─────────────────────────────────────────────────────────────────────────────
-- Security/perf hardening pass:
--  1) Two maintenance RPCs were callable directly by anon/authenticated even
--     though they're only ever meant to run from a trigger or pg_cron.
--  2) Chat/ticket messages and reviews had no per-user write throttling —
--     any authenticated JWT could script unlimited INSERTs straight against
--     PostgREST (RLS permits it; nothing capped the rate).
--  3) booster_applications had no cooldown, unlike order_drop_requests.
--  4) Admin Overview and the booster payout summary re-downloaded whole
--     tables to the client just to compute counts/sums — replaced with
--     server-side aggregate RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Lock down maintenance-only functions. SECURITY DEFINER functions invoked
-- by a trigger or pg_cron run with the definer's privileges regardless of the
-- caller's own EXECUTE grant, so revoking these does not break the existing
-- trigger (003_...sql:81-90) or the pg_cron schedule (001_...sql:1494-1510).
revoke all on function public.refresh_booster_rating(uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_pix_orders() from public, anon, authenticated;

-- 2) Per-user write rate limiting for direct-table inserts (no edge function
-- sits in front of these, so consume_edge_rate_limit — service_role only —
-- can't be called from the client). The subject is always auth.uid(),
-- derived server-side, never a client-supplied value, so it's safe to expose
-- this wrapper to `authenticated` unlike the raw rate-limit primitive.
create or replace function public.check_own_write_rate_limit(
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    return false;
  end if;
  v_result := public.consume_edge_rate_limit(p_scope, v_uid::text, p_limit, p_window_seconds);
  return coalesce((v_result->>'allowed')::boolean, false);
end;
$$;
revoke all on function public.check_own_write_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.check_own_write_rate_limit(text, integer, integer) to authenticated;

create or replace function public.trg_fn_enforce_message_rate_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_own_write_rate_limit('chat_message', 20, 60) then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_messages_rate_limit on public.order_messages;
create trigger trg_order_messages_rate_limit
  before insert on public.order_messages
  for each row execute function public.trg_fn_enforce_message_rate_limit();

drop trigger if exists trg_ticket_messages_rate_limit on public.ticket_messages;
create trigger trg_ticket_messages_rate_limit
  before insert on public.ticket_messages
  for each row execute function public.trg_fn_enforce_message_rate_limit();

create or replace function public.trg_fn_enforce_review_rate_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_own_write_rate_limit('review_submit', 5, 60) then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reviews_rate_limit on public.reviews;
create trigger trg_reviews_rate_limit
  before insert on public.reviews
  for each row execute function public.trg_fn_enforce_review_rate_limit();

-- 3) One pending application per user, same pattern as
-- order_drop_requests_one_pending_idx (007:49-50). The normal UI never hits
-- this (useBoosterStatus already hides the form while a pending application
-- exists), so this only ever blocks someone bypassing the UI to spam the
-- admin review queue.
create unique index if not exists booster_applications_one_pending_idx
  on public.booster_applications(user_id) where status = 'pending';

-- 4) Admin overview: one aggregate query instead of four unbounded
-- full-table fetches repeated every 30s (orders/payments/booster_profiles/
-- support_tickets in their entirety, client-side reduced to counts/sums).
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total_revenue numeric;
  v_active_orders integer;
  v_pending_boosters integer;
  v_open_tickets integer;
  v_urgent_tickets integer;
  v_recent_orders jsonb;
  v_daily_orders jsonb;
begin
  if not public.is_admin() then
    raise exception 'unauthorized';
  end if;

  select coalesce(sum(amount), 0) into v_total_revenue
  from public.payments where status = 'paid';

  select count(*) into v_active_orders
  from public.orders where status in ('assigned', 'in_progress', 'paused');

  select count(*) into v_pending_boosters
  from public.booster_profiles where status in ('pending', 'under_review');

  select count(*) into v_open_tickets
  from public.support_tickets where status = 'open';

  select count(*) into v_urgent_tickets
  from public.support_tickets where priority = 'urgent';

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_recent_orders from (
    select id, status, total_price, created_at
    from public.orders
    order by created_at desc
    limit 8
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_daily_orders from (
    select gs::date as day, count(o.id) as count
    from generate_series(current_date - interval '6 days', current_date, interval '1 day') gs
    left join public.orders o on o.created_at::date = gs::date
    group by gs
    order by gs
  ) t;

  return jsonb_build_object(
    'total_revenue', v_total_revenue,
    'active_orders_count', v_active_orders,
    'pending_boosters_count', v_pending_boosters,
    'open_tickets_count', v_open_tickets,
    'urgent_tickets_count', v_urgent_tickets,
    'recent_orders', v_recent_orders,
    'daily_orders', v_daily_orders
  );
end;
$$;
revoke all on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- Booster payout summary: was 4 client-side sums over every payout row the
-- booster has ever had (Dashboard.tsx). Aggregated server-side; the payout
-- history list itself stays a normal capped/paginated query.
create or replace function public.booster_payout_summary(p_booster_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total_earned numeric;
  v_total_withdrawn numeric;
  v_available numeric;
  v_processing numeric;
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'unauthorized';
  end if;

  select
    coalesce(sum(net_amount), 0),
    coalesce(sum(net_amount) filter (where status = 'paid'), 0),
    coalesce(sum(net_amount) filter (where status = 'pending'), 0),
    coalesce(sum(net_amount) filter (where status = 'processing'), 0)
  into v_total_earned, v_total_withdrawn, v_available, v_processing
  from public.payout_records
  where booster_id = p_booster_user_id;

  return jsonb_build_object(
    'total_earned', v_total_earned,
    'total_withdrawn', v_total_withdrawn,
    'available', v_available,
    'processing', v_processing
  );
end;
$$;
revoke all on function public.booster_payout_summary(uuid) from public, anon;
grant execute on function public.booster_payout_summary(uuid) to authenticated;
