-- W3 (correcoes da revisao): progresso so conta verificacoes do booster atual, negativo consome valor,
-- cancelar tambem reembolsa o pago nao consumido, Clash apos drop, stats do cliente pelo valor pago.
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public._order_progress_detail(p_order_id uuid, p_coaching_pct numeric DEFAULT NULL::numeric)
 RETURNS TABLE(fraction numeric, unit_ratio numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_latest record;
  v_mode text;
  v_from integer; v_to_full integer; v_to_std integer; v_l_step integer;
  v_total numeric := 0; v_done numeric := 0; v_next numeric := 0;
  v_mp numeric := 0; v_mp_done numeric := 0;
  v_cutoff integer; v_orig integer; v_latest_pdl integer;
begin
  fraction := 0; unit_ratio := 0;
  select service_type, boost_mode, queue_type, wins_purchased, wins_played, losses_played, match_sync_started_at,
         current_rank, target_rank, current_pdl, settled_value, amount_paid
    into o from public.orders where id = p_order_id;
  if not found then return next; return; end if;

  if o.service_type in ('win_boost', 'md5') then
    if coalesce(o.wins_purchased, 0) <= 0 then return next; return; end if;
    fraction := least(1, greatest(0, coalesce(o.wins_played, 0) - coalesce(o.losses_played, 0))::numeric / o.wins_purchased);
    unit_ratio := 1.0 / o.wins_purchased;
    return next; return;
  end if;

  if o.service_type = 'clash' then
    -- 3 partidas por Clash; so conta depois que o booster entrou.
    -- Depois de um drop positivo o preco ja foi reduzido pelas partidas entregues: o denominador encolhe junto.
    fraction := case when o.match_sync_started_at is null then 0
                     else least(1, (coalesce(o.wins_played, 0) + coalesce(o.losses_played, 0))
                                   / greatest(1, 3 - coalesce(round(3 * coalesce(o.settled_value, 0) / nullif(o.amount_paid, 0)), 0))::numeric) end;
    return next; return;
  end if;

  if o.service_type = 'coaching' then
    fraction := least(1, greatest(0, coalesce(p_coaching_pct, 0)) / 100.0);
    return next; return;
  end if;

  if o.service_type <> 'elo_boost' or o.current_rank is null or o.target_rank is null then
    return next; return;
  end if;

  select fetched_tier, fetched_division, fetched_lp into v_latest
    from public.order_rank_verifications where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;
  v_mode := coalesce(o.boost_mode, 'solo');

  -- Master+ (jogando dentro de Master+): fracao continua por PDL.
  if (o.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then
    v_orig := coalesce(o.current_pdl, 0);
    v_cutoff := coalesce(
      (select cutoff_lp from public.riot_league_cutoffs where queue = o.queue_type and tier = o.target_rank->>'tier'),
      case o.target_rank->>'tier' when 'grandmaster' then 1200 when 'challenger' then 2200 else 0 end);
    v_latest_pdl := coalesce(v_latest.fetched_lp, v_orig);
    fraction := case when v_cutoff <= v_orig then 1
                     else least(1, greatest(0, (v_latest_pdl - v_orig)::numeric / (v_cutoff - v_orig))) end;
    return next; return;
  end if;

  -- Elo padrao: degraus ponderados pelo preco real (nao linear) + LP dentro do degrau atual.
  v_from := public.rank_step(o.current_rank->>'tier', o.current_rank->>'division');
  v_to_full := public.rank_step(o.target_rank->>'tier', o.target_rank->>'division');
  v_to_std := least(v_to_full, 28);
  v_l_step := case when v_latest.fetched_tier is null then v_from
                   else public.rank_step(v_latest.fetched_tier, v_latest.fetched_division) end;

  select coalesce(sum(public._elo_step_cents(o.queue_type, v_mode, s)), 0),
         coalesce(sum(public._elo_step_cents(o.queue_type, v_mode, s)) filter (where s <= v_l_step), 0)
    into v_total, v_done
    from generate_series(v_from + 1, v_to_std) s;

  if v_l_step >= v_from and v_l_step < v_to_std and v_latest.fetched_lp is not null and v_latest.fetched_tier is not null then
    v_done := v_done + public._elo_step_cents(o.queue_type, v_mode, greatest(v_l_step, v_from) + 1)
                       * least(99, greatest(0, v_latest.fetched_lp)) / 100.0;
  end if;

  -- Alvo Grao-Mestre/Challenger a partir de Diamante-: trecho Master+ pesa pelo preco da tabela.
  if v_to_full > 28 then
    select coalesce(max(price), 0) * 100 into v_mp from public.master_plus_pricing
      where current_tier = 'master' and target_tier = o.target_rank->>'tier'
        and queue_type = o.queue_type and boost_mode = v_mode and pdl_from = 0;
    if v_mp > 0 and v_latest.fetched_tier in ('master', 'grandmaster', 'challenger') then
      v_cutoff := coalesce(
        (select cutoff_lp from public.riot_league_cutoffs where queue = o.queue_type and tier = o.target_rank->>'tier'),
        case o.target_rank->>'tier' when 'grandmaster' then 1200 else 2200 end);
      v_mp_done := v_mp * least(1, greatest(0, coalesce(v_latest.fetched_lp, 0)::numeric / greatest(1, v_cutoff)));
    end if;
  end if;

  if v_total + v_mp > 0 then
    fraction := least(1, greatest(0, (v_done + v_mp_done) / (v_total + v_mp)));
    -- Sem preco do trecho Master+ na tabela, nunca conta 100% antes de o alvo Master+ ser confirmado.
    if v_to_full > 28 and v_mp = 0 then fraction := least(fraction, 0.99); end if;
    v_next := public._elo_step_cents(o.queue_type, v_mode, least(greatest(v_l_step, v_from) + 1, greatest(v_to_std, v_from + 1)));
    unit_ratio := v_next / (v_total + v_mp);
  end if;
  return next; return;
end;
$function$;

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
    update public.orders set
      status                = 'under_review',
      assigned_booster_id   = null,
      preferred_booster_id  = null,
      exclusive_until       = null,
      used_exclusive_slot   = false,
      duo_own_riot_id       = null,
      drop_count            = drop_count + 1,
      last_dropped_at       = now(),
      updated_at            = now()
    where id = p_order_id;

    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = p_order_id;

    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, p_from_status::public.order_status, 'under_review', p_actor_id,
      'Limite de 2 drops atingido -- pedido cancelado; reembolso do cliente e saldo do booster pendentes de resolução manual. ' || p_reason
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido atingiu o limite de drops e está sendo analisado manualmente pela nossa equipe. Entraremos em contato pelo chat do pedido.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido que você tinha foi cancelado após atingir o limite de drops e está em análise manual da equipe.',
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
    status                 = 'awaiting_assignment',
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
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

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

CREATE OR REPLACE FUNCTION public._settle_order(p_order_id uuid, p_outcome text, p_reason text, p_coaching_pct numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_reason text := trim(p_reason);
  n jsonb;
  v_credit numeric; v_consumed numeric; v_refund numeric; v_booster uuid;
  v_payment_id uuid; v_refund_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if not public.check_own_write_rate_limit('admin_settle_order', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, status, customer_id, assigned_booster_id, payment_status into o
    from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if o.status <> 'under_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_under_review');
  end if;
  if o.payment_status <> 'paid' then
    return jsonb_build_object('success', false, 'error', 'order_not_paid');
  end if;

  n := public._order_settlement_numbers(p_order_id, p_coaching_pct);
  v_credit := (n->>'booster_credit')::numeric;
  v_consumed := (n->>'gross_consumed')::numeric;
  v_refund := (n->>'refund_amount')::numeric;
  v_booster := o.assigned_booster_id;

  if p_outcome = 'refund' and v_refund <= 0 then
    return jsonb_build_object('success', false, 'error', 'nothing_to_refund');
  end if;

  if v_booster is not null then
    if v_credit > 0 then
      perform 1 from public.booster_profiles where user_id = v_booster for update;
      update public.booster_profiles set total_earnings = total_earnings + v_credit where user_id = v_booster;
      insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role, metadata)
      values (v_booster, p_order_id, 'commission_credit', v_credit,
              'Pagamento pelo progresso entregue (' || (n->>'progress_pct') || '%) no pedido ' || p_order_id::text || ' encerrado pelo admin',
              auth.uid(), 'admin'::public.user_role, n);
    end if;
    insert into public.notifications(user_id, type, title, body, data)
    values (v_booster, 'order_status_changed', 'Pedido encerrado',
            'O pedido foi encerrado pela equipe.' ||
              case when v_credit > 0 then ' R$ ' || v_credit::text || ' foram creditados pelo progresso entregue.' else '' end,
            jsonb_build_object('order_id', p_order_id, 'amount', v_credit));
    update public.order_booster_assignments set unassigned_at = now()
     where order_id = p_order_id and unassigned_at is null;
    update public.duo_accounts set reserved_by = null, reserved_order_id = null, reserved_at = null
     where reserved_order_id = p_order_id;
  end if;

  update public.orders set
    assigned_booster_id = null, preferred_booster_id = null, exclusive_until = null, duo_own_riot_id = null,
    settled_value = settled_value + v_consumed,
    status = case when p_outcome = 'cancel' then 'canceled'::public.order_status else status end,
    updated_at = now()
  where id = p_order_id;

  if p_outcome = 'cancel' then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'under_review', 'canceled', auth.uid(), v_reason);
  end if;

  -- Cancelar ou reembolsar: o cliente sempre recebe de volta o pago ainda nao consumido.
  if v_refund > 0 then
    select id into v_payment_id from public.payments
     where order_id = p_order_id and status in ('paid', 'partially_refunded') order by created_at desc limit 1 for update;
    if v_payment_id is null then
      raise exception 'payment_not_found';
    end if;
    insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
    values (v_payment_id, p_order_id, 'manual-' || gen_random_uuid()::text, v_refund, v_reason, auth.uid(), 'pending', true)
    returning id into v_refund_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.settled_' || p_outcome, 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'numbers', n, 'refund_id', v_refund_id));

  insert into public.notifications(user_id, type, title, body, data)
  values (o.customer_id, 'order_status_changed',
          case when p_outcome = 'cancel' then 'Pedido cancelado' else 'Reembolso em processamento' end,
          case when p_outcome = 'cancel' then 'Seu pedido foi cancelado pela nossa equipe.' else 'Seu reembolso foi aprovado.' end
            || case when v_refund > 0 then ' R$ ' || v_refund::text || ' serão devolvidos a você.' else '' end,
          jsonb_build_object('order_id', p_order_id, 'refund_amount', v_refund));

  return jsonb_build_object('success', true, 'refund_id', v_refund_id) || n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_confirm_manual_refund(p_refund_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refund public.refunds%rowtype;
  v_order  record;
  v_pay    record;
  v_new_refunded numeric;
  v_pay_status public.payment_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  -- Mesma ordem de lock do webhook e da criacao: pedido, pagamento, reembolso.
  select id, status, customer_id into v_order from public.orders where id = v_refund.order_id for update;
  select id, amount, coalesce(refunded_amount, 0) as refunded_amount into v_pay
    from public.payments where id = v_refund.payment_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;
  v_new_refunded := v_pay.refunded_amount + v_refund.amount;
  if v_new_refunded > v_pay.amount then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  update public.refunds set status = 'succeeded' where id = v_refund.id;

  v_pay_status := case when v_new_refunded >= v_pay.amount then 'refunded' else 'partially_refunded' end;
  update public.payments set refunded_amount = v_new_refunded, status = v_pay_status, updated_at = now()
   where id = v_pay.id;

  -- O webhook do Mercado Pago pode ter reembolsado o pedido no meio tempo.
  if v_order.status not in ('refunded', 'canceled') then
    update public.orders set status = 'refunded'::public.order_status, payment_status = v_pay_status, updated_at = now()
     where id = v_order.id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_order.id, v_order.status, 'refunded'::public.order_status, auth.uid(),
            'Reembolso confirmado: ' || v_refund.reason);
  else
    update public.orders set payment_status = v_pay_status, updated_at = now() where id = v_order.id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_confirmed', 'order', v_order.id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount, 'payment_status', v_pay_status));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_status_changed', 'Reembolso processado',
            'R$ ' || v_refund.amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_refund.reason,
            jsonb_build_object('order_id', v_order.id, 'amount', v_refund.amount));
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_order_paid_customer_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if NEW.payment_status = 'paid'::public.payment_status
     and OLD.payment_status is distinct from 'paid'::public.payment_status then
    update public.customer_profiles
      set total_orders = total_orders + 1,
          total_spent  = total_spent + coalesce(NEW.amount_paid, NEW.total_price)
      where user_id = NEW.customer_id;
  end if;

  -- Reverses the increment above when a previously-counted order (i.e. one
  -- that had already moved past draft/awaiting_payment, so it was actually
  -- added to the totals at some point) ends up canceled or refunded.
  -- OLD.status not in (..., 'canceled', 'refunded') also guards against
  -- ever reversing the same order's contribution twice.
  if NEW.status in ('canceled', 'refunded')
     and OLD.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded') then
    update public.customer_profiles
      set total_orders = greatest(0, total_orders - 1),
          total_spent  = greatest(0, total_spent - coalesce(NEW.amount_paid, NEW.total_price))
      where user_id = NEW.customer_id;
  end if;

  return NEW;
end;
$function$;

-- Progresso so e visivel a cliente, booster atribuido ou admin (antes qualquer logado lia qualquer pedido).
create or replace function public.order_drop_completion_pct(p_order_id uuid)
 returns numeric language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not exists (
       select 1 from public.orders o
       where o.id = p_order_id and (public.is_admin() or o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())) then
    return null;
  end if;
  return round(public._order_progress_fraction(p_order_id) * 100, 2);
end;
$function$;

-- Lembretes do Discord (top 3 e saque) rodam todo dia e so disparam na janela de saque (15 / ultimo dia).
-- Os jobs HTTP so existem onde ha segredos (producao); no banco local nada acontece.
do $cron$
declare
  v_job record;
begin
  for v_job in select jobid, command from cron.job
               where jobname in ('discord-top3-announcement', 'discord-payout-window-reminder')
                 and command not like '%is_payout_window_day%'
  loop
    perform cron.alter_job(
      v_job.jobid, schedule := '0 12 * * *',
      command := regexp_replace(regexp_replace(v_job.command, '^\s*select\s+net\.http_post', 'select case when public.is_payout_window_day() then net.http_post'),
                                '\)\s*;\s*$', ') end;'));
  end loop;
end
$cron$;
