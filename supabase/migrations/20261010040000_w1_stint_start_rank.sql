-- C-1: o sync grava o rank ao vivo em orders.current_rank (checkpoint de vitoria/derrota); o progresso do elo_boost
-- passa a ser medido de orders.stint_start_rank (rank inicial do stint), nao do rank ao vivo.
-- Mesmas assinaturas (CREATE OR REPLACE) -- sem overload orfao.
set search_path = public, extensions;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stint_start_rank jsonb;

-- Backfill: pedidos que ainda nao foram reescritos pelo sync tem current_rank == rank inicial.
-- (Pedidos ja sincronizados em producao perderam a origem; ver AUDITORIA_BUGS.md C-1.)
UPDATE public.orders SET stint_start_rank = current_rank
 WHERE stint_start_rank IS NULL AND current_rank IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_order_current_rank(p_order_id uuid, p_tier text, p_division text, p_lp integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.orders
  set stint_start_rank = coalesce(stint_start_rank, current_rank),
      current_rank = jsonb_build_object('tier', p_tier, 'division', p_division, 'lp', p_lp)
  where id = p_order_id;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$function$;

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
         coalesce(stint_start_rank, current_rank) as baseline_rank, target_rank, current_pdl, settled_value, amount_paid
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

  if o.service_type <> 'elo_boost' or o.baseline_rank is null or o.target_rank is null then
    return next; return;
  end if;

  select fetched_tier, fetched_division, fetched_lp into v_latest
    from public.order_rank_verifications where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;
  v_mode := coalesce(o.boost_mode, 'solo');

  -- Master+ (jogando dentro de Master+): fracao continua por PDL.
  if (o.baseline_rank->>'tier') in ('master', 'grandmaster', 'challenger') then
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
  v_from := public.rank_step(o.baseline_rank->>'tier', o.baseline_rank->>'division');
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
  select id, service_type, boost_mode, queue_type, total_price, current_rank, stint_start_rank, target_rank,
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
  elsif v_order.service_type = 'elo_boost' and (coalesce(v_order.stint_start_rank, v_order.current_rank) is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ ─────────────────────────────────────────────
  elsif v_order.service_type = 'elo_boost'
    and (coalesce(v_order.stint_start_rank, v_order.current_rank)->>'tier') in ('master', 'grandmaster', 'challenger') then

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
    select fetched_tier, fetched_division, fetched_lp into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;
    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
      -- M-13: chegou a Master+ no fluxo padrao -- o proximo booster nao pode recontar o PDL ja entregue.
      if v_latest_rank.fetched_tier in ('master', 'grandmaster', 'challenger') then
        v_new_current_pdl := coalesce(v_latest_rank.fetched_lp, v_new_current_pdl);
      end if;
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
    reassigned_by_admin    = false,
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
    stint_start_rank       = v_new_current_rank,
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

CREATE OR REPLACE FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_latest record;
  v_from_step integer;
  v_to_step   integer;
  v_cur_step  integer;
begin
  select service_type, wins_played, wins_purchased, coalesce(stint_start_rank, current_rank) as current_rank, target_rank, pdl_bracket
  into v_order from public.orders where id = p_order_id;

  if not found then return 0; end if;

  if v_order.service_type in ('win_boost', 'md5') then
    if coalesce(v_order.wins_purchased, 0) <= 0 then return 0; end if;
    return least(100, greatest(0,
      (coalesce(v_order.wins_played, 0)::numeric / v_order.wins_purchased::numeric) * 100
    ));
  end if;

  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null and v_order.target_rank is not null then
    select fetched_tier, fetched_division, passed into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;

    -- Master+ (PDL): sem corte ao vivo disponível aqui -- só considera
    -- concluído (100%) se a última verificação já bateu o alvo.
    if v_order.pdl_bracket is not null then
      if v_latest.passed is true then return 100; end if;
      return 0;
    end if;

    if v_latest.fetched_tier is null then return 0; end if;

    v_from_step := public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division');
    v_to_step   := public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division');
    v_cur_step  := public.rank_step(v_latest.fetched_tier, v_latest.fetched_division);

    if v_to_step <= v_from_step then return 0; end if;
    return least(100, greatest(0,
      ((v_cur_step - v_from_step)::numeric / (v_to_step - v_from_step)::numeric) * 100
    ));
  end if;

  -- Clash, Coaching, placement_matches: sem progresso gradual.
  return 0;
end;
$$;

-- M-4/M-3: partidas de pedido em drop_requested tambem contam; fora da janela de atribuicao nao contam.
CREATE OR REPLACE FUNCTION "public"."record_order_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer, "p_duo_participated" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss', 'remake') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  if v_order.boost_mode = 'duo' and p_result <> 'remake' and not coalesce(p_duo_participated, false) then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'duo_not_participated');
  end if;

  v_booster_id := public.booster_assigned_at(p_order_id, p_played_at);
  if v_booster_id is null then
    -- M-3: partida fora de qualquer janela de atribuicao nao pertence ao booster atual.
    -- O fallback so vale para pedido legado sem NENHUMA linha de atribuicao.
    if exists (select 1 from public.order_booster_assignments where order_id = p_order_id) then
      return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'outside_assignment_window');
    end if;
    v_booster_id := v_order.assigned_booster_id;
  end if;

  insert into public.order_matches(
    order_id, booster_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, v_booster_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  -- Só conta pro progresso/penalidade do pedido ATUAL se a partida é mesmo
  -- da janela de atribuição em aberto -- senão pertence a um booster que já
  -- foi desassociado (drop/reassign), e o contador que a penalidade de drop
  -- lê (apply_order_drop) não é dele.
  if v_inserted and v_booster_id = v_order.assigned_booster_id then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    elsif p_result = 'loss' then
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."record_duo_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss', 'remake') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('in_progress', 'paused', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  v_booster_id := public.booster_assigned_at(p_order_id, p_played_at);
  if v_booster_id is null then
    -- M-3: partida fora de qualquer janela de atribuicao nao pertence ao booster atual.
    -- O fallback so vale para pedido legado sem NENHUMA linha de atribuicao.
    if exists (select 1 from public.order_booster_assignments where order_id = p_order_id) then
      return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'outside_assignment_window');
    end if;
    v_booster_id := v_order.assigned_booster_id;
  end if;
  if v_booster_id is null then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'no_booster_assigned');
  end if;

  insert into public.booster_duo_matches(
    order_id, booster_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, v_booster_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;
