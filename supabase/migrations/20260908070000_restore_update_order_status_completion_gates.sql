-- update_order_status perdeu as proteções de conclusão de novo -- a própria
-- migration 20260828100000_elo_boost_requires_rank_verification_gate.sql já
-- documentava que isso tinha acontecido uma vez ("cada `create or replace
-- function` substitui o corpo INTEIRO -- não é um patch, então uma migration
-- escrita a partir de uma cópia desatualizada apaga silenciosamente o que a
-- migration anterior tinha adicionado") e reincorporou tudo. A migration
-- seguinte que tocou esta função, 20260903150600_block_bypass_of_managed_
-- statuses.sql, afirma no comentário que "resto das duas funções idêntico à
-- versão vigente (migrations 131/139)" -- mas 131/139 são anteriores a
-- 20260828100000, a versão realmente vigente na hora; ela reescreveu a
-- função a partir dessa cópia velha e apagou os 4 gates de novo, sem que
-- ninguém notasse (a migration seguinte, 20260906060000_fix_update_order_
-- status_rate_limit.sql, só corrigiu rate limit/audit log em cima dessa
-- versão já regredida, sem restaurar o resto).
--
-- Efeito prático até este fix: update_order_status (RPC chamada direto pelo
-- booster via supabase.rpc(), sem edge function na frente) deixava
-- 'awaiting_customer' ser alcançado:
--   1. pra elo_boost, sem NUNCA verificar o rank alvo via Riot API
--      (target_rank is not null não era mais checado -- complete_verified_
--      order/verify-order-rank é o único caminho legítimo pra target_rank,
--      e ele nem passa por 'awaiting_customer');
--   2. pra Clash, antes das 23h do dia agendado (clash_completion_window);
--   3. pra qualquer serviço com contagem de partidas, mesmo sem NENHUMA
--      partida jogada ainda (no_matches_played);
--   4. pra Win Boost, contando vitórias BRUTAS em vez de líquidas (wins_played
--      >= wins_purchased, sem descontar losses_played) -- deixava "concluir"
--      com menos vitórias líquidas do que o cliente pagou na Garantia de Win
--      Rate (ver StepReview.tsx).
--
-- Fix: reincorpora os 4 gates de 20260828100000, mantendo o rate limit e o
-- audit log de admin que 20260906060000 adicionou por cima (e o bloqueio de
-- pending_review/under_review de 20260903150600). Coaching continua isento
-- do bloco de gates (v_order.service_type <> 'coaching'), como sempre foi --
-- não tem target_rank/partidas/janela, conclui só com o booster confirmando
-- a sessão dada.
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
$function$;
