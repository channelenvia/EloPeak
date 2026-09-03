-- admin_override_order_status e update_order_status já bloqueavam
-- 'awaiting_assignment' no ramo de admin (força uso de admin_drop_order/
-- apply_order_drop, que limpam assigned_booster_id, reserva de duo account,
-- preço proporcional etc -- ver migrations 131/139). 'pending_review' e
-- 'under_review' têm o mesmo problema: cada um só deveria ser alcançado
-- pelo fluxo próprio (process_mp_payment_event/release_paid_order_after_
-- credentials para pending_review; apply_order_drop pro limite de 2 drops
-- para under_review) porque carregam efeitos colaterais que esses bypasses
-- genéricos não replicam -- setar 'under_review' direto por aqui deixaria
-- assigned_booster_id e order_booster_assignments inconsistentes (o booster
-- continuaria "atribuído" num pedido cancelado).
--
-- Resto das duas funções idêntico à versão vigente (migrations 131/139) --
-- só o if de bloqueio muda de `= 'awaiting_assignment'` pra
-- `in ('awaiting_assignment', 'pending_review', 'under_review')`.
create or replace function public.admin_override_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default 'Admin override'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_new_status in ('awaiting_assignment', 'pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.orders set status = p_new_status::public.order_status, updated_at = now()
  where  id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_new_status::public.order_status, auth.uid(), p_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
          jsonb_build_object('from', v_order.status, 'to', p_new_status));

  return jsonb_build_object('success', true);
end;
$$;

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

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    if v_to_status in ('awaiting_assignment', 'pending_review', 'under_review') then
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

  if v_to_status = 'awaiting_customer'
     and v_order.wins_purchased is not null
     and v_order.wins_played < v_order.wins_purchased
  then
    return jsonb_build_object('success', false, 'error', 'objective_not_reached');
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
