-- Permanently expels a booster: sets booster_profiles.status='removed' and
-- flips profiles.role back to customer -- no row is deleted (see design doc
-- for why: most tables referencing a booster's profiles.id use
-- ON DELETE NO ACTION and would either block a real DELETE or, if forced,
-- destroy order/review/payout history). The actual login lockout (Auth ban)
-- happens in the expel-booster edge function, which calls this RPC first
-- and only bans on success.
--
-- Blocks if the booster has any order still active -- admin must resolve
-- those via the existing drop/reassignment tooling first; this RPC never
-- touches orders itself. Idempotent when the booster is already 'removed'
-- (needed so the edge function can safely retry after a ban-call failure
-- without re-running the active-orders guard against orders that may have
-- since become active again for some other reason).
--
-- Called only from the expel-booster edge function via the service-role
-- client (auth.uid() is null there) -- p_actor_id is the caller the edge
-- function already verified is an admin, same pattern as
-- complete_verified_order's p_requested_by (migration 011).
create or replace function public.expel_booster(
  p_booster_id uuid,
  p_reason     text,
  p_actor_id   uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor         record;
  v_booster       record;
  v_active_orders integer;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, user_id, status into v_booster
  from public.booster_profiles where id = p_booster_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  if v_booster.status <> 'removed' then
    select count(*) into v_active_orders
    from public.orders
    where assigned_booster_id = v_booster.user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested');

    if v_active_orders > 0 then
      return jsonb_build_object('success', false, 'error', 'active_orders_exist');
    end if;
  end if;

  select id, role into v_actor from public.profiles where id = p_actor_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'actor_not_found');
  end if;

  update public.booster_profiles
  set status = 'removed', suspended_until = null, updated_at = now()
  where id = p_booster_id;

  update public.profiles
  set role = 'customer'::public.user_role, updated_at = now()
  where id = v_booster.user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'booster.removed', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', trim(p_reason)));

  return jsonb_build_object('success', true, 'user_id', v_booster.user_id);
end;
$$;

revoke all on function public.expel_booster(uuid, text, uuid) from public, anon;
grant execute on function public.expel_booster(uuid, text, uuid) to service_role;
