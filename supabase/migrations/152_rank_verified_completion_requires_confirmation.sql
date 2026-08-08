-- Dois problemas no fluxo de conclusão de pedidos elo_boost:
--
-- 1. update_order_status permitia o booster marcar um elo_boost como
--    'awaiting_customer' direto (mesmo botão "Concluir" usado por
--    win_boost/md5/clash) só com base em wins_played+losses_played >= 1 --
--    o alvo de rank NUNCA era checado nesse caminho (só o wins_purchased,
--    que elo_boost nunca preenche). Só o botão separado "Verificar
--    Resultado" (edge function verify-order-rank -> complete_verified_order)
--    de fato consulta a Riot API e confere o rank alvo. Isso deixava
--    aberto um bypass: bastava chamar update_order_status diretamente pra
--    "concluir" um elo_boost sem nunca ter alcançado o rank contratado.
--    Fecha o bypass: qualquer pedido com target_rank preenchido (só
--    elo_boost usa esse campo) só pode chegar a 'awaiting_customer' via
--    complete_verified_order, nunca via update_order_status.
--
-- 2. complete_verified_order concluía o pedido direto pra 'completed',
--    pulando a confirmação do cliente que todo outro tipo de serviço passa
--    (win_boost/md5/clash chegam a 'awaiting_customer' e só viram
--    'completed' quando o cliente chama confirm_order_completion). Alinha
--    elo_boost ao mesmo fluxo: verificação de rank aprovada leva a
--    'awaiting_customer', não direto a 'completed' -- o cliente sempre
--    confirma a conclusão final, pra qualquer tipo de serviço.

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
         losses_played, match_sync_started_at, target_rank
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
    if v_order.target_rank is not null then
      return jsonb_build_object('success', false, 'error', 'requires_rank_verification');
    end if;

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

create or replace function public.complete_verified_order(
  p_order_id uuid,
  p_fetched_tier text,
  p_fetched_division text,
  p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_order record;
  v_target_tier text;
  v_target_division text;
begin
  select id, status, customer_id, assigned_booster_id, target_rank into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.assigned_booster_id is distinct from p_requested_by then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_order.target_rank is null then
    return jsonb_build_object('success', false, 'error', 'no_target_rank');
  end if;

  v_target_tier := v_order.target_rank->>'tier';
  v_target_division := v_order.target_rank->>'division';

  if public.rank_step(p_fetched_tier, p_fetched_division) is null
     or public.rank_step(v_target_tier, v_target_division) is null then
    return jsonb_build_object('success', false, 'error', 'invalid_rank_data');
  end if;

  if public.rank_step(p_fetched_tier, p_fetched_division) < public.rank_step(v_target_tier, v_target_division) then
    return jsonb_build_object('success', false, 'error', 'target_not_reached');
  end if;

  -- Rank alvo confirmado via Riot API -- mesmo assim vai pra
  -- 'awaiting_customer', não direto pra 'completed'. O cliente ainda
  -- precisa confirmar a entrega, igual a todo outro tipo de serviço; sem
  -- isso, elo_boost era o único fluxo que nunca passava pela confirmação
  -- (e nunca dava chance de abrir disputa) antes de liberar o pagamento.
  if v_order.status <> 'awaiting_customer' then
    update public.orders set status = 'awaiting_customer', updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, 'awaiting_customer', p_requested_by, 'Rank alvo verificado via Riot API');
  end if;

  insert into public.notifications(user_id, type, title, body, data)
  values (v_order.customer_id, 'order_status_changed', 'Objetivo alcançado!',
          'Verificamos que sua conta atingiu o rank alvo. Confirme a conclusão do pedido.',
          jsonb_build_object('order_id', p_order_id));

  return jsonb_build_object('success', true);
end;
$$;
