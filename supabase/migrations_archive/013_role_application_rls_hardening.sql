-- Security hardening: booster applications must not self-promote roles, and
-- owner-scoped UPDATE policies must keep ownership after the update.

-- Existing rows created by the legacy request_booster_role() flow may have
-- role = booster before admin approval. Keep approved boosters and admins as-is;
-- demote every non-approved booster account back to customer.
update public.profiles p
set role = 'customer',
    updated_at = now()
where p.role = 'booster'
  and not exists (
    select 1
    from public.booster_profiles bp
    where bp.user_id = p.id
      and bp.status = 'approved'
  );

-- A customer may start a booster application, but role changes happen only in
-- approve_booster(). This keeps route/role separation aligned with real review.
create or replace function public.request_booster_role()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Onboarding is allowed for customers applying for booster status and for
-- existing boosters editing their application/profile data. It does not grant
-- the booster role; approval below is the only role transition.
create or replace function public.onboard_booster(
  p_display_name      text,
  p_bio               text,
  p_peak_rank         jsonb,
  p_opgg_link         text    default null,
  p_hours_per_day_min integer default null,
  p_hours_per_day_max integer default null,
  p_full_name         text    default null,
  p_cpf               text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role  public.user_role;
  v_email text;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  if nullif(trim(p_display_name), '') is null or length(trim(p_display_name)) > 80 then
    return jsonb_build_object('success', false, 'error', 'invalid_display_name');
  end if;

  if p_bio is not null and length(p_bio) > 256 then
    return jsonb_build_object('success', false, 'error', 'invalid_bio');
  end if;

  if p_hours_per_day_min is not null and (p_hours_per_day_min < 1 or p_hours_per_day_min > 24) then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  if p_hours_per_day_max is not null and (p_hours_per_day_max < 1 or p_hours_per_day_max > 24) then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  if p_hours_per_day_min is not null
     and p_hours_per_day_max is not null
     and p_hours_per_day_max < p_hours_per_day_min then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.booster_profiles(
    user_id, display_name, bio, status,
    peak_rank, opgg_link, hours_per_day_min, hours_per_day_max,
    full_name, email, cpf
  )
  values (
    auth.uid(), trim(p_display_name), nullif(trim(coalesce(p_bio, '')), ''), 'pending',
    p_peak_rank, nullif(trim(coalesce(p_opgg_link, '')), ''), p_hours_per_day_min, p_hours_per_day_max,
    nullif(trim(coalesce(p_full_name, '')), ''), v_email, nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '')
  )
  on conflict (user_id) do update set
    display_name      = excluded.display_name,
    bio               = excluded.bio,
    peak_rank         = excluded.peak_rank,
    opgg_link         = excluded.opgg_link,
    hours_per_day_min = excluded.hours_per_day_min,
    hours_per_day_max = excluded.hours_per_day_max,
    full_name         = excluded.full_name,
    email             = excluded.email,
    cpf               = excluded.cpf,
    updated_at        = now();

  return jsonb_build_object('success', true);
end;
$$;

-- Admin approval is the only path that grants role = booster. Rejection or
-- suspension removes booster route access while keeping the application record.
create or replace function public.approve_booster(
  p_booster_id uuid,
  p_new_status text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor record;
  v_booster_user_id uuid;
  v_status public.booster_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_status := p_new_status::public.booster_status;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set    status      = v_status,
         verified_at = case when v_status = 'approved' then now() else null end,
         updated_at  = now()
  where  id = p_booster_id
  returning user_id into v_booster_user_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  update public.profiles
  set role = case when v_status = 'approved' then 'booster'::public.user_role else 'customer'::public.user_role end,
      updated_at = now()
  where id = v_booster_user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role, 'booster.' || v_status::text, 'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- Boosters may only move assigned active orders through an explicit state
-- machine. Admins keep using admin_override_order_status() for exceptional
-- cases, with audit logging.
create or replace function public.update_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_to_status public.order_status;
  v_allowed boolean := false;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    update public.orders set status = v_to_status, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, auth.uid(), coalesce(p_reason, 'Admin status update'));

    return jsonb_build_object('success', true);
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_allowed := case
    when v_order.status = 'assigned'          and v_to_status = 'in_progress' then true
    when v_order.status = 'in_progress'       and v_to_status in ('paused', 'awaiting_customer') then true
    when v_order.status = 'paused'            and v_to_status in ('in_progress', 'awaiting_customer') then true
    when v_order.status = 'awaiting_customer' and v_to_status in ('in_progress', 'paused') then true
    else false
  end;

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', 'invalid_transition');
  end if;

  update public.orders set status = v_to_status, updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;

-- Preserve ownership on owner-updatable profile tables. The triggers remain as
-- column-level defense, but RLS now also requires ownership after UPDATE.
drop policy if exists "customer_profiles_update_own" on public.customer_profiles;
create policy "customer_profiles_update_own" on public.customer_profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "booster_profiles_update_own_or_admin" on public.booster_profiles;
create policy "booster_profiles_update_own_or_admin" on public.booster_profiles for update
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "tickets_update" on public.support_tickets;
create policy "tickets_update" on public.support_tickets for update
using (customer_id = auth.uid() or public.is_admin())
with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.trg_fn_guard_notifications_user_update()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.user_id    := old.user_id;
    new.type       := old.type;
    new.title      := old.title;
    new.body       := old.body;
    new.data       := old.data;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_notifications_user_update on public.notifications;
create trigger trg_guard_notifications_user_update
before update on public.notifications
for each row execute function public.trg_fn_guard_notifications_user_update();

-- Maintenance-only RPC; callable use should be internal/admin mediated, not any
-- authenticated user. Public direct execution can force aggregate refresh work.
revoke all on function public.refresh_top5_boosters() from public, anon, authenticated;
