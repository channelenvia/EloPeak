-- Booster nunca conseguia solicitar drop de um pedido de coaching --
-- request_order_drop bloqueia 'in_progress' sem last_match_synced_at
-- (pensado pra garantir uma leitura confiável de wins_played/losses_played
-- antes do drop, nos serviços com partida). Coaching nunca passa por
-- 'assigned' (accept_boost_order já entrega direto em 'in_progress', ver
-- 20260906050000) e nunca tem riot_id (orderPricing.ts, normalizeOtherIntent
-- -- "Riot ID não é aceito em Coaching"), então nunca é elegível pro cron/
-- endpoint de sync (ambos filtram riot_id is null) -- last_match_synced_at
-- fica null pra sempre. Resultado: a guarda achava que TODO pedido de
-- coaching "ainda não sincronizou", e bloqueava o drop permanentemente --
-- único jeito de sair era o admin forçar via admin_drop_order (que não tem
-- essa guarda). Fix: a guarda só faz sentido pra serviços com partida.
create or replace function public.request_order_drop(
  p_order_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_existing uuid;
begin
  if not public.check_own_write_rate_limit('request_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, assigned_booster_id, wins_played,
         losses_played, last_match_synced_at, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if coalesce(v_order.drop_count, 0) >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where order_id = p_order_id and status = 'pending';
  if found then
    return jsonb_build_object('success', false, 'error', 'drop_request_already_pending');
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, requested_by_role, status_at_request
  ) values (
    p_order_id, auth.uid(), v_reason, v_order.wins_played, v_order.losses_played,
    0, 0, 'booster', v_order.status
  );

  update public.orders set status = 'drop_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'drop_request_pending_admin', 'Nova solicitação de drop',
         'Um booster solicitou o drop de um pedido e aguarda aprovação.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true);
end;
$$;
