-- Atualiza os 2 chamadores de apply_order_drop pra passar o novo parâmetro
-- p_requester_role (migration anterior) e gravar o novo formato de retorno
-- (payout_amount/penalty_amount/is_positive substituem completion_pct/
-- penalty_bucket/penalty_fee_pct/penalty_fee_amount/warning_issued, que
-- não existem mais -- o sistema de multa%/advertência/bloqueio foi
-- removido). As colunas antigas em order_drop_requests continuam existindo
-- (histórico não é reescrito), só param de ser preenchidas.

-- ── admin_drop_order: requester_role sempre 'admin' (drop unilateral) ───
create or replace function public.admin_drop_order(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_result jsonb;
  v_request_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role);

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_amount, status, admin_id, admin_note, resolved_at, requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(), 'admin'
  )
  returning id into v_request_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_dropped_by_admin', 'Você foi removido de um pedido',
    'Um administrador retirou você do pedido. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

  return jsonb_build_object('success', true);
end;
$$;

-- ── resolve_drop_request: requester_role vem da request original ────────
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    v_result := public.apply_order_drop(v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role);

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_amount = coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
           resolved_at = now()
    where  id = p_request_id;
  else
    v_restore_status := coalesce(v_req.status_at_request, 'in_progress');

    update public.orders set status = v_restore_status, updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', v_restore_status, auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));

    update public.order_drop_requests
    set    status      = 'rejected',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           resolved_at = now()
    where  id = p_request_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;
