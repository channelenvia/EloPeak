-- update_order_status perdeu VÁRIAS proteções ao longo de migrations
-- recentes que se sobrescreveram sem incorporar as anteriores (cada
-- `create or replace function` substitui o corpo INTEIRO -- não é um
-- patch, então uma migration escrita a partir de uma cópia desatualizada
-- apaga silenciosamente o que a migration anterior tinha adicionado):
--
--   1. target_rank (elo_boost) nunca ganhou um gate de conclusão --
--      um booster podia chamar esta RPC direto (fora da UI, que já esconde
--      o botão via src/lib/orderCompletionGate.ts) e levar o pedido pra
--      'awaiting_customer' sem nunca ter alcançado o rank contratado. A
--      verificação real (complete_verified_order, migration 011) vai direto
--      pra 'completed' sem passar por 'awaiting_customer' -- é o único
--      caminho válido de conclusão pra pedidos com target_rank.
--   2. O gate de janela do Clash (só libera 'awaiting_customer' às 23h do
--      dia do match_sync_started_at) e o gate de "nenhuma partida jogada"
--      (no_matches_played) existiam numa migration anterior e sumiram.
--   3. Rate limit (check_own_write_rate_limit) nunca chegou a esta função
--      pelo caminho que sobreviveu -- RPC chamada direto do cliente via
--      supabase.rpc(), sem edge function na frente pra throttle-la.
--
-- Este fix reincorpora as 3 lacunas, preservando a correção mais recente
-- que sobreviveu (vitórias líquidas pra win_boost: wins_played - losses_played
-- >= wins_purchased, em vez de vitórias cruas -- ver StepReview.tsx,
-- "Garantia de Win Rate - Vitórias Extras").

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

      if v_order.wins_purchased is not null then
        v_effective_wins := case
          when v_order.service_type = 'win_boost' then v_order.wins_played - v_order.losses_played
          else v_order.wins_played
        end;
        if v_effective_wins < v_order.wins_purchased then
          return jsonb_build_object('success', false, 'error', 'objective_not_reached');
        end if;
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
