-- Bug: update_order_status (migration 139, campo objective_not_reached)
-- liberava "Finalizar pedido" pra win_boost olhando só wins_played cru contra
-- wins_purchased, ignorando losses_played -- mas a garantia vendida ao
-- cliente (StepReview.tsx, "Garantia de Win Rate - Vitórias Extras") é de
-- SALDO LÍQUIDO: toda derrota durante o serviço precisa ser compensada com
-- uma vitória extra, então contratar 5 vitórias e perder 2 no meio do
-- caminho exige 7 vitórias jogadas (5+2), não 5. O gate real pra win_boost é
-- (wins_played - losses_played) >= wins_purchased.
--
-- md5 usa os MESMOS campos (wins_purchased/wins_played/losses_played) só que
-- pra uma garantia diferente (win RATE de 80%+, não saldo líquido 1:1) --
-- continua olhando só vitórias cruas, comportamento inalterado.
--
-- Mesmo fix já aplicado no gate client-side (src/lib/orderCompletionGate.ts)
-- que só decide se o botão "Finalizar pedido" aparece habilitado -- esta é a
-- validação de verdade (RPC security definer), sem ela um booster podia
-- finalizar via chamada direta à RPC mesmo sem compensar a derrota.
--
-- Resto da função idêntico à versão vigente (migration 139) -- só o branch
-- de objective_not_reached muda, e losses_played entra no select.
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
  v_effective_wins integer;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played, losses_played
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

  if v_to_status = 'awaiting_customer' and v_order.wins_purchased is not null then
    v_effective_wins := case
      when v_order.service_type = 'win_boost' then v_order.wins_played - v_order.losses_played
      else v_order.wins_played
    end;
    if v_effective_wins < v_order.wins_purchased then
      return jsonb_build_object('success', false, 'error', 'objective_not_reached');
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
