-- W3: cancelar pedido em analise usa a liquidacao (credito ao booster pelo progresso).
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.admin_cancel_pending_review_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order  record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;
  -- Pedido ja analisado (pago, com ou sem booster): cancelamento passa pela liquidacao, que paga o
  -- booster pelo progresso e registra o que sobrou para reembolso.
  if v_order.status = 'under_review' then
    return public._settle_order(p_order_id, 'cancel', v_reason, null);
  end if;

  update public.orders
  set status                    = 'canceled',
      assigned_booster_id       = null,
      preferred_booster_id      = case when v_order.assigned_booster_id is not null then null else preferred_booster_id end,
      exclusive_until           = case when v_order.assigned_booster_id is not null then null else exclusive_until end,
      used_exclusive_slot       = case when v_order.assigned_booster_id is not null then false else used_exclusive_slot end,
      under_review_from_status  = null,
      under_review_started_at   = null,
      admin_review_locked       = false,
      review_release_at         = null,
      updated_at                = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido cancelado',
      'Um pedido seu que estava em análise foi cancelado pela administração. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_canceled', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'had_assigned_booster', v_order.assigned_booster_id is not null));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido foi cancelado pela administração. Motivo: ' || v_reason
        || '. O reembolso será tratado manualmente pela nossa equipe.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;
