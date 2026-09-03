-- Bug: depois da migration 153 (drop_request_approval_limit), um pedido que
-- já teve 2 drops aprovados (orders.drop_count >= 2) ficava travado -- tanto
-- resolve_drop_request(p_approve => true) quanto admin_drop_order só
-- devolviam 'drop_limit_reached' e paravam. Isso incluía o próprio admin, que
-- é exatamente quem deveria conseguir agir nesse caso (request_order_drop /
-- request_customer_order_drop continuam corretos: booster/cliente não podem
-- abrir uma 3a solicitação -- só o admin decide o que acontece dali pra
-- frente).
--
-- Regra de produto (correção): a partir da 3a vez, só o admin consegue
-- dropar -- e esse drop excedente CANCELA o pedido em vez de devolvê-lo pra
-- fila (apply_order_drop). Sem pagamento proporcional automático -- o admin
-- resolve com o cliente e com o booster associado individualmente (reembolso
-- manual via admin_create_manual_refund, ajuste de saldo se for o caso).
--
-- cancel_order_after_drop_limit(): função nova, espelha o "corpo" de
-- apply_order_drop (mesma trava de linha, mesma limpeza de reserva de duo
-- account, mesmo padrão de order_status_history) mas termina em 'canceled'
-- ao invés de 'awaiting_assignment', e não mexe em preço/horas/vitórias nem
-- credita o booster -- é encerramento, não continuação.
create or replace function public.cancel_order_after_drop_limit(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_completion_pct numeric;
begin
  select id, customer_id, assigned_booster_id
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('completion_pct', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  update public.orders set
    status     = 'canceled',
    updated_at = now()
  where id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'canceled', p_actor_id, p_reason);

  if v_order.assigned_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_dropped_by_admin', 'Pedido cancelado pelo admin',
      'Este pedido atingiu o limite de 2 drops e foi cancelado por um administrador. Motivo: ' || p_reason
        || '. Nosso time vai falar com você individualmente sobre o pagamento.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido atingiu o limite de 2 drops e foi cancelado. Nosso time vai entrar em contato para resolver individualmente.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('completion_pct', v_completion_pct);
end;
$$;

revoke all on function public.cancel_order_after_drop_limit(uuid, text, uuid, text) from public, anon, authenticated;

-- ── resolve_drop_request: aprovar acima do limite cancela em vez de travar ─
-- Base: migrations_archive/20260824060000_remove_booster_drop_warning_system.sql
-- (versão vigente) -- só o branch de aprovação muda.
create or replace function public.resolve_drop_request(p_request_id uuid, p_approve boolean, p_admin_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
  v_drop_count integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    select drop_count into v_drop_count from public.orders where id = v_req.order_id;

    if coalesce(v_drop_count, 0) >= 2 then
      v_result := public.cancel_order_after_drop_limit(
        v_req.order_id, 'drop_requested', auth.uid(),
        coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado pelo admin')
      );

      insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
      values (v_actor.id, v_actor.role, 'drop_request.approved_as_cancel', 'order_drop_request', p_request_id::text,
              jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

      update public.order_drop_requests
      set    status         = 'approved',
             admin_id       = auth.uid(),
             admin_note     = coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado'),
             penalty_pct    = (v_result->>'completion_pct')::numeric,
             penalty_amount = 0,
             resolved_at    = now()
      where  id = p_request_id;

      return jsonb_build_object('success', true, 'canceled', true);
    end if;

    v_result := public.apply_order_drop(v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved');

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_pct    = (v_result->>'completion_pct')::numeric,
           penalty_amount = (v_result->>'payout_amount')::numeric,
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

  return jsonb_build_object('success', true, 'canceled', false);
end;
$$;

-- ── admin_drop_order: dropar acima do limite cancela em vez de travar ──────
-- Base: migrations_archive/20260824060000_remove_booster_drop_warning_system.sql
-- (versão vigente).
create or replace function public.admin_drop_order(p_order_id uuid, p_reason text)
returns jsonb
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

  select id, status, assigned_booster_id, wins_played, losses_played, drop_count
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

  if v_order.drop_count >= 2 then
    v_result := public.cancel_order_after_drop_limit(p_order_id, v_order.status::text, auth.uid(), v_reason);

    insert into public.order_drop_requests(
      order_id, booster_id, reason, wins_at_request, losses_at_request,
      penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
      requested_by_role
    ) values (
      p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
      (v_result->>'completion_pct')::numeric, 0,
      'approved', auth.uid(), 'Limite de 2 drops atingido -- pedido cancelado pelo admin', now(),
      'admin'
    )
    returning id into v_request_id;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.admin_canceled_after_drop_limit', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

    return jsonb_build_object('success', true, 'canceled', true);
  end if;

  v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason);

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
    requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    (v_result->>'completion_pct')::numeric, (v_result->>'payout_amount')::numeric,
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(),
    'admin'
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

  return jsonb_build_object('success', true, 'canceled', false);
end;
$$;
