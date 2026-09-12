-- Bug: request_order_drop and admin_reassign_booster both got a
-- `service_type <> 'coaching'` exemption from the last_match_synced_at guard
-- (migrations 20260908080000/90000) because coaching never has a riot_id and
-- so never syncs a match -- last_match_synced_at stays null forever. But
-- request_customer_order_drop (last redefined in
-- migrations_archive/20260903150700, before that fix pass) has the SAME
-- guard and was missed: a customer could never request a drop on their own
-- in_progress coaching order, permanently blocked waiting on a sync that can
-- never happen. Fix mirrors the exemption already applied to its siblings.
create or replace function public.request_customer_order_drop(
  p_order_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_existing uuid;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, customer_id, assigned_booster_id, wins_played,
         losses_played, last_match_synced_at, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if coalesce(v_order.drop_count, 0) >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where order_id = p_order_id and status = 'pending';
  if found then
    return jsonb_build_object('success', false, 'error', 'drop_request_already_pending');
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, requested_by_role, status_at_request
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, 0, 0,
    'customer', v_order.status
  );

  update public.orders set status = 'drop_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop',
    'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'drop_request_pending_admin', 'Nova solicitação de drop',
         'Um cliente solicitou a troca de booster e aguarda aprovação.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.request_customer_order_drop(uuid, text) from public, anon;
grant execute on function public.request_customer_order_drop(uuid, text) to authenticated;
