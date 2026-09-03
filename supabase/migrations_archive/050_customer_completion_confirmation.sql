-- Fecha o buraco do fluxo de conclusão: um pedido virava 'awaiting_customer'
-- (booster clica "Marcar como concluído") e nada no backend jamais permitia
-- o cliente confirmar — a única saída era admin_override_order_status manual.
-- get_customer_order_state() nem sequer devolvia essa possibilidade. Pedidos
-- de win_boost também podiam entrar em awaiting_customer com 0 vitórias
-- registradas, sem nenhuma validação de progresso.
--
-- Esta migration:
-- 1. Adiciona validação de progresso em update_order_status() para pedidos
--    de vitórias avulsas (wins_purchased) antes de aceitar a transição para
--    'awaiting_customer'.
-- 2. Adiciona confirm_order_completion() — só o customer_id do pedido pode
--    chamar, só a partir de 'awaiting_customer', libera 'completed' (o
--    trigger trg_order_completed_booster_stats já cuida do payout).
-- 3. Adiciona dispute_order_completion() — mesmo pedido, mesma origem, mas
--    para quando o cliente discorda que o objetivo foi atingido; reaproveita
--    o status 'disputed' já existente (resolvido depois via
--    admin_override_order_status, que já ignora a máquina de transições).

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

  -- Progresso mínimo: pedidos de vitórias avulsas só podem ir para
  -- "aguardando cliente" depois de atingir as vitórias contratadas. Pedidos
  -- sem wins_purchased (elo_boost, coaching, md5, placement_matches) não têm
  -- esse contador como critério de objetivo e seguem sem essa checagem extra.
  if v_to_status = 'awaiting_customer'
     and v_order.wins_purchased is not null
     and v_order.wins_played < v_order.wins_purchased
  then
    return jsonb_build_object('success', false, 'error', 'objective_not_reached');
  end if;

  update public.orders set status = v_to_status, updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.confirm_order_completion(
  p_order_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'awaiting_customer' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.orders set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_customer', 'completed', auth.uid(), 'Cliente confirmou a conclusão');

  if v_order.assigned_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.assigned_booster_id, 'order_completed', 'Cliente confirmou a conclusão!',
            'O cliente confirmou a entrega e seus ganhos foram liberados.',
            jsonb_build_object('order_id', p_order_id));
  end if;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.dispute_order_completion(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select id, status, customer_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'awaiting_customer' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.orders set status = 'disputed', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_customer', 'disputed', auth.uid(), btrim(p_reason));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.confirm_order_completion(uuid) from public, anon;
revoke all on function public.dispute_order_completion(uuid, text) from public, anon;
grant execute on function public.confirm_order_completion(uuid) to authenticated;
grant execute on function public.dispute_order_completion(uuid, text) to authenticated;

-- get_customer_order_state() centraliza toda capacidade do cliente sobre o
-- próprio pedido — precisa saber sobre a confirmação de conclusão também,
-- em vez do frontend inferir isso sozinho a partir do status bruto.
create or replace function public.get_customer_order_state(
  p_order_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order record;
  v_requires_credentials boolean;
  v_is_active_paid boolean;
begin
  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_order_id is null then
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where customer_id = v_customer_id
      and status = 'awaiting_payment'
    order by created_at desc
    limit 1;

    if not found then
      return jsonb_build_object('success', true, 'order_id', null);
    end if;
  else
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where id = p_order_id
      and customer_id = v_customer_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'order_not_found');
    end if;
  end if;

  v_requires_credentials := public.order_requires_access_token(
    v_order.service_type,
    v_order.boost_mode
  );
  v_is_active_paid := v_order.payment_status = 'paid'::public.payment_status
    and v_order.status in (
      'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer'
    );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'can_pay', v_order.status = 'awaiting_payment'
      and coalesce(v_order.payment_status, 'pending'::public.payment_status) = 'pending'::public.payment_status,
    'payment_confirmed', v_is_active_paid,
    'requires_credentials', v_requires_credentials,
    'credentials_set', v_order.credentials_set,
    'can_submit_credentials', v_is_active_paid and v_requires_credentials,
    'can_confirm_completion', v_order.status = 'awaiting_customer'
  );
end;
$$;

revoke all on function public.get_customer_order_state(uuid) from public, anon;
grant execute on function public.get_customer_order_state(uuid) to authenticated;
