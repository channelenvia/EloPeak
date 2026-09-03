-- Achado da 4ª rodada: update_order_status (migration 052) tem o mesmo
-- bypass irrestrito de admin que admin_override_order_status tinha antes do
-- fix da migration 131 -- o branch `if public.is_admin() then` aceita
-- QUALQUER p_new_status, inclusive 'awaiting_assignment', sem passar por
-- apply_order_drop (que limpa assigned_booster_id, reserva de duo account,
-- preço proporcional etc). Hoje não é explorável (o frontend só chama essa
-- RPC pelo caminho de booster, nunca com um admin autenticado tentando
-- 'awaiting_assignment'), mas é uma segunda porta pra reintroduzir o mesmo
-- bug que 131 já fechou em admin_override_order_status, caso algum código
-- futuro passe a chamar essa RPC a partir de uma tela admin.
--
-- Fix: mesmo bloqueio, mesma mensagem de erro ('use_admin_drop_order_instead').
-- Resto da função idêntico à versão vigente (migration 052).
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
