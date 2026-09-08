-- Manual "Suspender" (admin, Boosters.tsx) suspended a booster indefinitely
-- until someone clicked "Reativar". Product wants this time-boxed to 24h,
-- auto-lifting on its own. Unrelated to the automatic drop-penalty
-- suspension (apply_order_drop, migration 128) or its blocked_until column
-- -- both untouched here. See
-- docs/superpowers/specs/2026-08-03-booster-suspend-expel-design.md.

alter table public.booster_profiles
  add column suspended_until timestamptz;

comment on column public.booster_profiles.suspended_until is
  'When a manual 24h suspension (approve_booster with status=suspended) '
  'auto-expires. Null = not suspended, or suspended with no expiry (legacy '
  'rows predating this column). Distinct from blocked_until, which is the '
  'unrelated automatic drop-warning throttle on taking NEW orders.';

-- ── approve_booster: set/clear suspended_until alongside status ────────────
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
  set    status          = v_status,
         verified_at     = case when v_status = 'approved' then now() else null end,
         suspended_until = case when v_status = 'suspended' then now() + interval '24 hours' else null end,
         updated_at      = now()
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

-- ── Auto-expiry: flips status back to approved once suspended_until passes ─
create or replace function public.expire_stale_booster_suspensions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booster record;
begin
  for v_booster in
    select id, user_id
    from public.booster_profiles
    where status = 'suspended'
      and suspended_until is not null
      and suspended_until <= now()
    for update
  loop
    update public.booster_profiles
    set status = 'approved', suspended_until = null, verified_at = now(), updated_at = now()
    where id = v_booster.id;

    update public.profiles
    set role = 'booster'::public.user_role, updated_at = now()
    where id = v_booster.user_id
      and role <> 'admin';

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
    values (v_booster.user_id, 'booster', 'booster.auto_reactivated', 'booster_profile', v_booster.id::text);
  end loop;
end;
$$;

revoke all on function public.expire_stale_booster_suspensions() from public, anon, authenticated;
grant execute on function public.expire_stale_booster_suspensions() to service_role;

do $$
begin
  perform cron.unschedule('expire-stale-booster-suspensions');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'expire-stale-booster-suspensions',
    '*/5 * * * *',
    $cron$select public.expire_stale_booster_suspensions();$cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — expire_stale_booster_suspensions() exists but is not scheduled';
end $$;
