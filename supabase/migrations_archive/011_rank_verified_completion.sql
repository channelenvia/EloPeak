-- ─────────────────────────────────────────────────────────────────────────────
-- Rank-verified order completion. Today "completed" is reachable only via
-- admin_override_order_status — a pure status write with zero verification
-- that the customer's account actually reached the target rank. This adds a
-- server-verified path: a booster requests verification, an edge function
-- checks the real rank via the Riot Games API, and only a passing result
-- (re-derived here in SQL too, never just trusted from the edge function)
-- can flip the order to 'completed'. The admin manual-override escape hatch
-- is untouched for edge cases (API outage, private profile, etc).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.orders add column if not exists riot_id text;

create table public.order_rank_verifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  requested_by uuid not null references public.profiles(id),
  riot_id_checked text not null,
  fetched_tier text,
  fetched_division text,
  target_tier text not null,
  target_division text,
  passed boolean not null,
  error_reason text,
  created_at timestamptz not null default now()
);
create index order_rank_verifications_order_idx on public.order_rank_verifications(order_id);

alter table public.order_rank_verifications enable row level security;

-- Written only by the verify-order-rank edge function via the service-role
-- client (bypasses RLS) — same pattern as orders creation (no insert policy
-- for authenticated/anon). Read access: the booster who requested it, the
-- order's customer, or an admin.
create policy "order_rank_verifications_read" on public.order_rank_verifications for select using (
  requested_by = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
);

-- Mirrors shared/pricing.ts's rankStep() exactly — same ordering, same
-- master/grandmaster/challenger overrides — so the DB can independently
-- re-derive "did they reach the target" instead of trusting the caller.
create or replace function public.rank_step(p_tier text, p_division text)
returns integer
language sql immutable as $$
  select case
    when p_tier = 'master' then 28
    when p_tier = 'grandmaster' then 29
    when p_tier = 'challenger' then 30
    else
      (array_position(array['iron','bronze','silver','gold','platinum','emerald','diamond'], p_tier) - 1) * 4
      + coalesce(array_position(array['IV','III','II','I'], p_division), 1) - 1
  end
$$;

-- Only the verify-order-rank edge function (service_role) may call this —
-- a booster JWT can never reach 'completed' by calling it directly, no
-- matter what it claims the fetched rank was; the comparison is re-checked
-- here against the order's own target_rank.
create or replace function public.complete_verified_order(
  p_order_id uuid,
  p_fetched_tier text,
  p_fetched_division text,
  p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_target_tier text;
  v_target_division text;
begin
  select id, status, customer_id, assigned_booster_id, target_rank into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.assigned_booster_id is distinct from p_requested_by then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_order.target_rank is null then
    return jsonb_build_object('success', false, 'error', 'no_target_rank');
  end if;

  v_target_tier := v_order.target_rank->>'tier';
  v_target_division := v_order.target_rank->>'division';

  -- rank_step() returns null for an unrecognized tier — never let that
  -- resolve to a passing "not less than" comparison (null < x is null,
  -- i.e. neither true nor false; treat unmappable data as a hard fail).
  if public.rank_step(p_fetched_tier, p_fetched_division) is null
     or public.rank_step(v_target_tier, v_target_division) is null then
    return jsonb_build_object('success', false, 'error', 'invalid_rank_data');
  end if;

  if public.rank_step(p_fetched_tier, p_fetched_division) < public.rank_step(v_target_tier, v_target_division) then
    return jsonb_build_object('success', false, 'error', 'target_not_reached');
  end if;

  update public.orders set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'completed', p_requested_by, 'Rank alvo verificado via Riot API');

  insert into public.notifications(user_id, type, title, body, data)
  values (v_order.customer_id, 'order_completed', 'Pedido concluído!',
          'Verificamos que sua conta atingiu o rank alvo. Seu pedido foi concluído.',
          jsonb_build_object('order_id', p_order_id));

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.complete_verified_order(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.complete_verified_order(uuid, text, text, uuid) to service_role;
