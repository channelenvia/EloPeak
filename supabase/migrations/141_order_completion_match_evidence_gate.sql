-- update_order_status only ever checked wins_played >= wins_purchased before
-- letting a booster move an order to awaiting_customer -- that only covers
-- win_boost/md5. elo_boost, clash and placement_matches had no server-side
-- check at all (objectiveReached on the client defaulted to true whenever
-- wins_purchased was null), so a direct RPC call could mark any of those
-- "done" with zero matches played. See
-- docs/superpowers/specs/2026-08-03-order-completion-gating-design.md.
--
-- Two new gates, both only applied to the in_progress -> awaiting_customer
-- transition, same place the existing wins_purchased check already lives:
--   1. clash: blocked until 23:00 America/Sao_Paulo on/after the day the
--      order started (match_sync_started_at) -- and, once past that
--      instant, never re-locks (computed once as a fixed instant, not as a
--      recurring "current hour >= 23" check, which would wrongly re-block
--      the order between 00:00-22:59 the day after the window first opened).
--   2. everything else except coaching: wins_played + losses_played >= 1 --
--      at least one Riot-synced match on this order. wins_played/losses_played
--      are only ever written by record_order_match (migration 132), called
--      exclusively from the sync-order-matches edge function after fetching
--      real Match-V5 data, so this can't be gamed by the booster or customer.
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
  v_local_start timestamp;
  v_unlock_local timestamp;
  v_unlock_at timestamptz;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played,
         losses_played, match_sync_started_at
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    if v_to_status = 'awaiting_assignment' then
      return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
    end if;

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

  if v_to_status = 'awaiting_customer' and v_order.service_type <> 'coaching' then
    if v_order.service_type = 'clash' then
      if v_order.match_sync_started_at is null then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;

      v_local_start := v_order.match_sync_started_at at time zone 'America/Sao_Paulo';
      v_unlock_local := date_trunc('day', v_local_start) + interval '23 hours';
      if v_unlock_local < v_local_start then
        v_unlock_local := v_unlock_local + interval '1 day';
      end if;
      v_unlock_at := v_unlock_local at time zone 'America/Sao_Paulo';

      if now() < v_unlock_at then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;
    else
      if (v_order.wins_played + v_order.losses_played) < 1 then
        return jsonb_build_object('success', false, 'error', 'no_matches_played');
      end if;

      if v_order.wins_purchased is not null and v_order.wins_played < v_order.wins_purchased then
        return jsonb_build_object('success', false, 'error', 'objective_not_reached');
      end if;
    end if;
  end if;

  update public.orders set
    status = v_to_status,
    updated_at = now(),
    match_sync_started_at = case
      when v_order.status = 'assigned' and v_to_status = 'in_progress'
        then coalesce(match_sync_started_at, now())
      else match_sync_started_at
    end
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;
