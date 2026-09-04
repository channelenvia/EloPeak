-- Reverte 2 decisões que a migration 20260903150700 mudou sem confirmação:
--
-- 1) admin_assign_pending_review_order: a 150700 passou a atribuir direto
--    (status='assigned', sem passar por aceite). O combinado original (ver
--    20260903140100) é reserva com janela de 12h de aceite, igual um pedido
--    exclusivo comprado direto do perfil de um booster -- volta a isso.
--
-- 2) apply_order_drop, ramo negativo do Elo/Duo abaixo de Mestre+: a 150700
--    removeu a distinção de quem pediu o drop (sempre usava o valor com
--    desconto de comissão). O combinado original é que ISSO TAMBÉM distingue
--    -- booster que pede paga o valor cheio (v_division_value_full), cliente/
--    admin descontam a comissão (v_division_value_share) -- mesma regra já
--    usada em Win Boost e Mestre+. Resto da função (fix do preço bruto no
--    Mestre+/Elo positivo, current_pdl carregado adiante, fechamento de
--    order_booster_assignments no ramo principal) continua exatamente como
--    a 150700 deixou -- essas eram correções reais, não decisões revertidas.

create or replace function public.apply_order_drop(
  p_order_id        uuid,
  p_from_status     text,
  p_actor_id        uuid,
  p_reason          text,
  p_requester_role  public.drop_requester_role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_divisions_remaining    numeric;
  v_division_value_full    numeric;
  v_division_value_share   numeric;
  v_steps_crossed          integer;
  v_win_value_master_cents integer;
  v_win_value_master_full  numeric;
  v_win_value_master_share numeric;
  v_cutoff_pdl             integer;
  v_original_pdl           integer;
  v_latest_pdl             integer;
  v_new_current_pdl        integer;
  v_pdl_remaining          numeric;
  v_quarter_pdl            numeric;
  v_booster_share          numeric;
  v_quarter_value          numeric;
  v_quarters_completed     integer;
  v_completion_pct         numeric;
  v_completion_frac        numeric;
begin
  select id, service_type, boost_mode, queue_type, total_price, current_rank, target_rank,
         current_pdl, customer_id, assigned_booster_id, estimated_hours, wins_played,
         losses_played, wins_purchased, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned');
  end if;

  perform 1 from public.booster_profiles where user_id = v_order.assigned_booster_id for update;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  v_is_positive := coalesce(v_order.wins_played, 0) >= coalesce(v_order.losses_played, 0);
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

  -- ── Win Boost / MD5 ──────────────────────────────────────────────────
  if v_order.service_type in ('win_boost', 'md5') then
    v_win_value_unit := case
      when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
      else 0
    end;

    v_new_wins_purchased := greatest(0,
      coalesce(v_order.wins_purchased, 0) - coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0));

    v_new_total_price := round(v_win_value_unit * v_new_wins_purchased, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null and coalesce(v_order.wins_purchased, 0) > 0
        then round(v_order.estimated_hours / v_order.wins_purchased * v_new_wins_purchased, 2)
      else v_order.estimated_hours
    end;
    v_new_current_rank := v_order.current_rank;

    if v_is_positive then
      v_payout := round(v_win_value_unit * v_share_pct * coalesce(v_order.wins_played, 0), 2);
    else
      v_penalty := case
        when p_requester_role = 'booster' then v_order.total_price
        else round(v_order.total_price * v_share_pct, 2)
      end;
    end if;

  -- ── Elo/Duo Boost: current_rank/target_rank nulos são um estado de dados
  -- inválido pra esse service_type (nunca deveriam estar assim num pedido
  -- ativo) -- sem essa guarda, rank_step(null, ...) propaga NULL até
  -- total_price silenciosamente. Falha alto e claro em vez disso.
  elsif v_order.service_type = 'elo_boost' and (v_order.current_rank is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ (current tier já em master/gm/challenger) ─
  elsif v_order.service_type = 'elo_boost'
    and (v_order.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then

    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    select fetched_tier, fetched_division
    into v_latest_rank
    from public.order_rank_verifications
    where order_id = p_order_id order by created_at desc limit 1;

    select fetched_lp into v_latest_pdl
    from public.order_rank_verifications
    where order_id = p_order_id order by created_at desc limit 1;

    v_latest_pdl := coalesce(v_latest_pdl, v_order.current_pdl, 0);
    v_new_current_pdl := v_latest_pdl;
    v_new_current_rank := case
      when v_latest_rank.fetched_tier is not null
        then jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division)
      else v_order.current_rank
    end;

    v_win_value_master_cents := public.win_price_cents(
      v_order.queue_type,
      v_order.boost_mode,
      coalesce(v_latest_rank.fetched_tier, v_order.current_rank->>'tier')
    );
    v_win_value_master_full  := v_win_value_master_cents / 100.0;
    -- Comissão fixa de 45% só neste ramo (negativo, quando o cliente pede) --
    -- diferente do share_pct dinâmico (55/60 top3) usado em todo o resto.
    v_win_value_master_share := round(v_win_value_master_full * 0.55, 2);

    if v_is_positive then
      v_cutoff_pdl := coalesce(
        (select cutoff_lp from public.riot_league_cutoffs
          where queue = v_order.queue_type and tier = v_order.target_rank->>'tier'),
        case v_order.target_rank->>'tier'
          when 'grandmaster' then 1200
          when 'challenger' then 2200
          else 0
        end
      );
      v_original_pdl := coalesce(v_order.current_pdl, 0);

      v_pdl_remaining := greatest(0, v_cutoff_pdl - v_original_pdl);
      v_quarter_pdl    := v_pdl_remaining / 4.0;
      v_booster_share  := round(v_order.total_price * v_share_pct, 2);
      v_quarter_value  := round(v_booster_share / 4.0, 2);

      v_quarters_completed := case
        when v_quarter_pdl <= 0 then 4
        else least(4, floor(greatest(0, v_latest_pdl - v_original_pdl) / v_quarter_pdl)::integer)
      end;

      v_payout := v_quarter_value * v_quarters_completed;
      -- total_price é o bruto pago pelo cliente. Remove a fração bruta
      -- concluída; subtrair v_payout aplicava a comissão uma segunda vez ao
      -- próximo booster.
      v_new_total_price := greatest(0, round(
        v_order.total_price * (1 - v_quarters_completed / 4.0), 2
      ));
    else
      v_penalty := round(
        (case when p_requester_role = 'booster' then v_win_value_master_full else v_win_value_master_share end)
        * coalesce(v_order.losses_played, 0), 2);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Elo/Duo Boost -- padrão (abaixo de Mestre) ──────────────────────────
  elsif v_order.service_type = 'elo_boost' then
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    v_divisions_remaining := greatest(0,
      public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division')
      - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division'));

    v_division_value_full  := case when v_divisions_remaining > 0 then v_order.total_price / v_divisions_remaining else 0 end;
    v_division_value_share := round(v_division_value_full * v_share_pct, 2);

    select fetched_tier, fetched_division into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id order by created_at desc limit 1;

    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
      v_steps_crossed := greatest(0,
        public.rank_step(v_latest_rank.fetched_tier, v_latest_rank.fetched_division)
        - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division'));
    else
      v_new_current_rank := v_order.current_rank;
      v_steps_crossed := 0;
    end if;

    if v_is_positive then
      v_payout := round(v_division_value_share * v_steps_crossed, 2);
      -- O preço do pedido é bruto, portanto também precisa ser reduzido
      -- pelo valor bruto das divisões concluídas.
      v_new_total_price := greatest(0, round(
        v_order.total_price - (v_division_value_full * v_steps_crossed), 2
      ));
    else
      -- Restaurado: também distingue quem pediu, igual Win Boost e Mestre+
      -- (a 20260903150700 tinha removido essa distinção -- decisão revertida
      -- a pedido explícito, ver conversa).
      v_win_value_unit := round(
        (case when p_requester_role = 'booster' then v_division_value_full else v_division_value_share end) / 4.0, 2);
      v_penalty := round(v_win_value_unit * coalesce(v_order.losses_played, 0), 2);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Demais tipos (coaching, placement_matches, clash): sem fórmula
  -- específica no plano -- mantém o cálculo proporcional genérico de
  -- antes (completion_pct * share_pct), sem penalidade negativa.
  else
    v_completion_pct  := public.order_drop_completion_pct(p_order_id);
    v_completion_frac := v_completion_pct / 100.0;
    v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
      else null
    end;
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_current_rank := v_order.current_rank;
    v_payout := round(v_order.total_price * v_share_pct * v_completion_frac, 2);
  end if;

  -- ── Aplica o resultado ao pedido ────────────────────────────────────
  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
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
    'is_positive', v_is_positive
  );
end;
$$;

revoke all on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role) from public, anon, authenticated;
grant execute on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role) to service_role;

-- ── admin_assign_pending_review_order: volta a reservar com janela de 12h
-- de aceite (preferred_booster_id + exclusive_until), igual um pedido
-- exclusivo comprado direto do perfil de um booster -- em vez da atribuição
-- direta que a 20260903150700 introduziu. O booster só ganha o pedido de
-- fato quando aceitar via accept_boost_order (que já insere em
-- order_booster_assignments); esta função não insere lá.
create or replace function public.admin_assign_pending_review_order(
  p_order_id           uuid,
  p_target_booster_id  uuid,
  p_reason             text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_target record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'pending_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set status                = 'awaiting_assignment',
      preferred_booster_id  = p_target_booster_id,
      exclusive_until       = now() + interval '12 hours',
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at            = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, 'pending_review', 'awaiting_assignment', auth.uid(),
    'Atribuído pelo admin durante a revisão: ' || v_reason
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'exclusive_job', 'Pedido reservado para você!',
    'Um administrador reservou este pedido pra você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_assigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'target_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_assign_pending_review_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_assign_pending_review_order(uuid, uuid, text) to authenticated;
