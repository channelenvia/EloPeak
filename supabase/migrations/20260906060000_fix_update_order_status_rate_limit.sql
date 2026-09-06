-- Bug 1: update_order_status (RPC direta do booster) não passa por
-- check_own_write_rate_limit, diferente de toda RPC irmã de escrita do
-- cliente (accept_boost_order, request_order_drop, set_order_credentials
-- etc). Isso permite ao booster martelar toggles de status
-- (assigned<->in_progress<->paused<->awaiting_customer) sem throttle, o que
-- também redispara o webhook do Discord de notificação de status a cada
-- chamada.
--
-- Bug 2: o branch de admin pula o insert em audit_logs que o quase-idêntico
-- admin_override_order_status sempre grava, perdendo rastreabilidade de
-- overrides de admin feitos por este ponto de entrada.
--
-- Fix: aplicar o mesmo gate check_own_write_rate_limit usado pelas RPCs
-- irmãs no caminho do booster (o branch de admin já não é rate-limited em
-- nenhuma RPC de admin, então mantemos o padrão), e espelhar o insert em
-- audit_logs de admin_override_order_status no branch de admin.
create or replace function public.update_order_status(p_order_id uuid, p_new_status text, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_actor record;
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

    select id, role into v_actor from public.profiles where id = auth.uid();

    update public.orders set status = v_to_status, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, auth.uid(), coalesce(p_reason, 'Admin status update'));

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
            jsonb_build_object('from', v_order.status, 'to', v_to_status));

    return jsonb_build_object('success', true);
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('update_order_status', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
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
$function$;
