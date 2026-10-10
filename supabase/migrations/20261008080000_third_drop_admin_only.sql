-- 3o drop: so o admin dropa; o pedido vai para analise com o booster vinculado para liquidacao manual pelo progresso.
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.apply_order_drop(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requester_role drop_requester_role, p_coaching_completion_pct numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order                 record;
  v_is_top3                boolean;
  v_share_pct              numeric;
  v_is_positive            boolean;
  v_over_limit             boolean;
  v_payout                 numeric := 0;
  v_penalty                numeric := 0;
  v_new_total_price        numeric;
  v_new_wins_purchased     integer;
  v_new_estimated_hours    numeric;
  v_new_current_rank       jsonb;
  v_latest_rank            record;
  v_win_value_unit         numeric;
  v_division_value_full    numeric;
  v_win_value_master_cents integer;
  v_win_value_master_full  numeric;
  v_win_value_master_share numeric;
  v_latest_pdl             integer;
  v_new_current_pdl        integer;
  v_f                      numeric;
  v_unit_ratio             numeric;
  v_consumed               numeric;
  v_net                    integer;
  v_complete               boolean := false;
begin
  select id, service_type, boost_mode, queue_type, total_price, current_rank, target_rank,
         current_pdl, customer_id, assigned_booster_id, estimated_hours, wins_played,
         losses_played, wins_purchased, drop_count, status
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned');
  end if;

  if v_order.status::text <> p_from_status then
    return jsonb_build_object('success', false, 'error', 'order_status_mismatch');
  end if;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id for update;
  -- Coaching tem taxa própria e fixa (70%, ver trg_fn_order_completed_booster_stats
  -- e boosterEarningsShare em src/lib/utils.ts) -- não varia com is_top3.
  v_share_pct := case
    when v_order.service_type = 'coaching' then 0.70
    when v_is_top3 then 0.60
    else 0.55
  end;

  v_is_positive := case
    when v_order.service_type in ('win_boost', 'md5', 'elo_boost')
      then coalesce(v_order.wins_played, 0) >= coalesce(v_order.losses_played, 0)
    else true
  end;
  v_over_limit  := v_order.drop_count >= 2;
  v_new_current_pdl := v_order.current_pdl;

  -- ── Limite de 2 drops: cancela em vez de reabrir, tudo manual daqui ────
  if v_over_limit then
    -- 3o drop (so o admin chega aqui): o pedido vai para analise MANTENDO o booster e os contadores, para o admin
    -- acertar manualmente (liquidacao): o booster recebe pelo progresso e o cliente recebe o restante.
    update public.orders set
      status                    = 'under_review',
      under_review_from_status  = v_order.status,
      under_review_started_at   = now(),
      admin_review_locked       = false,
      review_release_at         = null,
      drop_count                = drop_count + 1,
      last_dropped_at           = now(),
      updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, p_from_status::public.order_status, 'under_review', p_actor_id,
      'Limite de 2 drops atingido -- pedido em analise manual; pagamento do booster e reembolso do cliente seguem o progresso. ' || p_reason
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido atingiu o limite de trocas de booster e está em análise manual da nossa equipe. O reembolso será calculado pelo progresso do pedido. Falamos com você pelo chat do pedido.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido seu atingiu o limite de drops e está em análise manual da equipe. Você será pago pelo progresso entregue.',
      jsonb_build_object('order_id', p_order_id)
    );

    return jsonb_build_object('success', true, 'under_review', true, 'drop_count', v_order.drop_count + 1);
  end if;

  -- ── Progresso do booster atual (mesma definicao do cancelamento e das telas) ──
  select fraction, unit_ratio into v_f, v_unit_ratio
    from public._order_progress_detail(p_order_id, p_coaching_completion_pct);
  v_f := coalesce(v_f, 0);
  v_consumed := round(v_order.total_price * v_f, 2);
  v_new_wins_purchased := v_order.wins_purchased;
  v_new_estimated_hours := v_order.estimated_hours;
  v_new_current_rank := v_order.current_rank;

  -- ── Win Boost / MD5 ──────────────────────────────────────────────────
  if v_order.service_type in ('win_boost', 'md5') then
    v_win_value_unit := case
      when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
      else 0
    end;
    v_net := greatest(0, coalesce(v_order.wins_played, 0) - coalesce(v_order.losses_played, 0));

    if v_is_positive then
      -- Empate (ex.: 3V/3D) nao paga nada: so o saldo liquido de vitorias conta.
      v_new_wins_purchased := greatest(0, coalesce(v_order.wins_purchased, 0) - v_net);
      v_payout := round(v_consumed * v_share_pct, 2);
    else
      v_new_wins_purchased := greatest(0,
        coalesce(v_order.wins_purchased, 0) - coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0));
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_unit, round(v_win_value_unit * v_share_pct, 2), v_order.losses_played);
    end if;
    v_new_total_price := round(v_win_value_unit * v_new_wins_purchased, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null and coalesce(v_order.wins_purchased, 0) > 0
        then round(v_order.estimated_hours / v_order.wins_purchased * v_new_wins_purchased, 2)
      else v_order.estimated_hours
    end;

  -- ── Elo/Duo Boost: rank atual/alvo nulos e um estado invalido ─────────────
  elsif v_order.service_type = 'elo_boost' and (v_order.current_rank is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ ─────────────────────────────────────────────
  elsif v_order.service_type = 'elo_boost'
    and (v_order.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then

    select fetched_tier, fetched_division, fetched_lp
    into v_latest_rank
    from public.order_rank_verifications
    where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;

    v_latest_pdl := coalesce(v_latest_rank.fetched_lp, v_order.current_pdl, 0);
    v_new_current_pdl := v_latest_pdl;
    v_new_current_rank := case
      when v_latest_rank.fetched_tier is not null
        then jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division)
      else v_order.current_rank
    end;

    if v_is_positive then
      v_payout := round(v_consumed * v_share_pct, 2);
      v_new_total_price := greatest(0, round(v_order.total_price - v_consumed, 2));
    else
      v_win_value_master_cents := public.win_price_cents(
        v_order.queue_type, v_order.boost_mode,
        coalesce(v_latest_rank.fetched_tier, v_order.current_rank->>'tier'));
      v_win_value_master_full := v_win_value_master_cents / 100.0;
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_master_full, round(v_win_value_master_full * v_share_pct, 2), v_order.losses_played);
      -- O progresso (se houve) sai do preco; a penalidade vai inteira para o proximo booster.
      v_new_total_price := round(v_order.total_price - v_consumed + v_penalty, 2);
    end if;

  -- ── Elo/Duo Boost -- padrao (abaixo de Mestre) ──────────────────────────
  elsif v_order.service_type = 'elo_boost' then
    select fetched_tier, fetched_division into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;
    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
    end if;

    if v_is_positive then
      v_payout := round(v_consumed * v_share_pct, 2);
      v_new_total_price := greatest(0, round(v_order.total_price - v_consumed, 2));
    else
      -- Cada derrota custa 1/4 do valor do degrau em disputa (peso real do degrau, nao a media).
      v_division_value_full := round(v_order.total_price * coalesce(v_unit_ratio, 0), 2);
      v_penalty := public.compute_drop_penalty(
        p_requester_role, round(v_division_value_full / 4.0, 2),
        round(v_division_value_full * v_share_pct / 4.0, 2), v_order.losses_played);
      v_new_total_price := round(v_order.total_price - v_consumed + v_penalty, 2);
    end if;

  -- ── Clash, coaching e placement: so existe drop positivo (progresso x preco) ──
  else
    v_new_total_price := round(v_order.total_price - v_consumed, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null then round(v_order.estimated_hours * (1 - v_f), 2)
      else null
    end;
    v_payout := round(v_consumed * v_share_pct, 2);
  end if;

  -- Nada mais a entregar: conclui em vez de reabrir um pedido de preco zero.
  -- O trigger de conclusao paga o booster sobre o preco vigente (sem somar v_payout).
  v_complete := v_is_positive and v_new_total_price <= 0 and v_order.total_price > 0;

  if v_complete then
    update public.orders set status = 'completed', completed_at = now(), updated_at = now(),
           settled_value = settled_value + v_consumed
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, p_from_status::public.order_status, 'completed', p_actor_id,
            'Objetivo ja entregue ao solicitar o drop -- pedido concluido. ' || p_reason);
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_completed', 'Pedido concluido',
            'O objetivo do seu pedido ja tinha sido entregue e ele foi concluido.',
            jsonb_build_object('order_id', p_order_id));
    return jsonb_build_object('success', true, 'completed', true, 'payout_amount', 0, 'penalty_amount', 0,
                              'new_total_price', v_order.total_price, 'is_positive', true);
  end if;

  -- ── Aplica o resultado ao pedido ────────────────────────────────────
  update public.orders set
    status                 = case when v_order.service_type = 'coaching' then 'under_review'::public.order_status else 'awaiting_assignment'::public.order_status end,
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    duo_own_riot_id        = null,
    total_price            = v_new_total_price,
    base_price             = v_new_total_price,
    extras_price           = 0,
    discount_price         = 0,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    current_pdl            = v_new_current_pdl,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    settled_value          = settled_value + v_consumed,
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id
    and booster_id = v_order.assigned_booster_id
    and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status,
          case when v_order.service_type = 'coaching' then 'under_review'::public.order_status else 'awaiting_assignment'::public.order_status end,
          p_actor_id, p_reason);

  -- Coaching nao volta ao pool (so o coach dono do pacote enxerga): o admin escolhe o novo coach.
  if v_order.service_type = 'coaching' then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'coaching_needs_new_coach', 'Coaching sem coach',
           'O coach largou o pedido ' || p_order_id::text || '. Escolha um novo coach em Atribuir booster.',
           jsonb_build_object('order_id', p_order_id)
    from public.profiles where role = 'admin';
  end if;

  if v_payout > 0 then
    update public.booster_profiles set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial pelo progresso entregue no pedido ' || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'R$ ' || v_payout::text || ' foi creditado ao seu saldo pelo progresso entregue antes do drop.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout)
    );
  end if;

  if v_penalty > 0 then
    -- Espelha o crédito de payout logo acima -- sem isso, total_earnings
    -- (exibido ao admin em BoosterDetail.tsx) ficava inflado depois de
    -- qualquer drop com penalidade (o saldo sacável real já vinha certo,
    -- por ser derivado do ledger via booster_available_balance).
    update public.booster_profiles set total_earnings = total_earnings - v_penalty
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_penalty,
      'Penalidade por drop em desvantagem no pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Penalidade de drop aplicada',
      'R$ ' || v_penalty::text || ' foi descontado do seu saldo por dropar o pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_penalty)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payout_amount', v_payout,
    'penalty_amount', v_penalty,
    'new_total_price', v_new_total_price,
    'is_positive', v_is_positive,
    'progress_fraction', v_f
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_order_drop(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 3o drop e so do admin (admin_drop_order): ele acerta booster e cliente manualmente pelo progresso.
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
$function$;

CREATE OR REPLACE FUNCTION public.request_customer_order_drop(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_existing uuid;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, customer_id, assigned_booster_id, wins_played,
         losses_played, last_match_synced_at, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;

  -- 3o drop e so do admin (admin_drop_order): ele acerta booster e cliente manualmente pelo progresso.
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
    p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, 0, 0,
    'customer', v_order.status
  );

  update public.orders set status = 'drop_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop',
    'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'drop_request_pending_admin', 'Nova solicitação de drop',
         'Um cliente solicitou a troca de booster e aguarda aprovação.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true);
end;
$function$;
