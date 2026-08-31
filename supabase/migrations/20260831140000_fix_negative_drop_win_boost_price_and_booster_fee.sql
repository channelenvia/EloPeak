-- Corrige 2 problemas no drop negativado (mais derrotas que vitórias)
-- relatados pelo usuário com um caso real: pedido de 1 win Wins/Solo-Duo em
-- Ouro (total_price = R$ 3,97, já com desconto de pacote de 1 vitória
-- aplicado na compra), 1 derrota real no drop -- negative_matches = 1.
--
-- 1. v_new_total_price (win_boost/md5) usava win_value_cents(), a tabela
--    FIXA de preço cheio por tier (win_penalty_price_cents -- R$ 5,67 pro
--    Ouro solo) em vez do preço por vitória REALMENTE vendido neste pedido
--    (v_order.total_price / v_order.wins_purchased = R$ 3,97). Resultado
--    observado: pedido de 1 win vira "2 vitórias restantes" reprecificado
--    em R$ 11,34 (2 × 5,67) quando deveria ser R$ 7,94 (2 × 3,97) -- ignora
--    qualquer desconto de pacote/cupom que o cliente tenha recebido na
--    compra original. Fix: usa o preço por vitória do próprio pedido, com
--    fallback pra win_value_cents só se wins_purchased estiver ausente/
--    zerado (não deveria acontecer em win_boost/md5).
--
-- 2. v_fee_amount (taxa de drop cobrada do booster que estava no pedido)
--    era `novo_total_price - o_que_o_cliente_pagou` -- isso cobra do
--    booster a comissão CHEIA (100% do valor de venda) de TODAS as
--    vitórias que faltam, incluindo a vitória original que o cliente
--    sempre teria pago de qualquer forma, não só a que o próprio booster
--    "estragou". Fix confirmado com o usuário: o booster só deveria perder
--    a PRÓPRIA comissão (55%/60%, conforme top3) referente às partidas
--    negativadas que ele causou -- `partidas_negativadas × preço_por_vitória
--    × comissão_do_booster`. Ex.: 1 partida negativada × R$ 3,97 × 55% =
--    R$ 2,18 (não mais os R$ 7,37 que a fórmula antiga cobrava).
--    cancel_order_after_drop_limit (2º drop, pedido CANCELADO em vez de
--    re-listado) já usava essa fórmula baseada em comissão -- só não
--    considerava o preço real de venda do win_boost/md5, mesma causa raiz
--    do item 1; ganha o mesmo fix aqui.
--
-- Sem mudança de escopo: elo_boost continua usando win_value_cents (tabela
-- por tier) pra ambos os cálculos -- não existe "preço por vitória vendido"
-- pra Elo Boost, o preço é por distância de rank. O pagamento parcial por
-- conclusão (v_payout) e o gate de rank fresco continuam inalterados.

create or replace function public.apply_order_drop(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requested_by_role drop_requester_role DEFAULT 'admin'::drop_requester_role)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order               record;
  v_completion_pct      numeric;
  v_completion_frac     numeric;
  v_is_top3             boolean;
  v_share_pct           numeric;
  v_payout              numeric;
  v_latest              record;
  v_new_current_rank    jsonb;
  v_new_total_price     numeric;
  v_new_estimated_hours numeric;
  v_new_wins_purchased  integer;
  v_price_changed       boolean;
  v_fee_amount          numeric := 0;
  v_negative_matches    integer;
  v_win_cents           integer;
  v_price_per_win       numeric;
  v_sub_master_cents    integer;
  v_master_plus_price   numeric := 0;
  v_mp_current_tier     text;
  v_tgt_tier            text;
  v_tgt_div             text;
begin
  select id, service_type, total_price, current_rank, target_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased, boost_mode, queue_type
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned', 'completion_pct', 0, 'payout_amount', 0);
  end if;

  v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));

  if v_order.service_type = 'elo_boost' and v_negative_matches > 0
     and not public.elo_rank_verification_fresh(p_order_id) then
    return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop', 'completion_pct', 0, 'payout_amount', 0);
  end if;

  perform 1 from public.booster_profiles where user_id = v_order.assigned_booster_id for update;

  v_completion_pct  := public.order_drop_completion_pct(p_order_id);
  v_completion_frac := v_completion_pct / 100.0;
  v_price_changed   := v_completion_frac > 0;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  v_payout := round(v_order.total_price * v_share_pct * v_completion_frac, 2);

  v_win_cents := case
    when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
      then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
    else 0
  end;

  v_new_current_rank := v_order.current_rank;
  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null then
    select fetched_tier, fetched_division into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;
    if v_latest.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest.fetched_tier, 'division', v_latest.fetched_division);
    end if;
  end if;

  if v_negative_matches > 0 and v_order.service_type in ('elo_boost', 'win_boost', 'md5') then
    -- Pedido dropado negativado: reprecifica do zero -- o próximo booster
    -- precisa vencer as vitórias/degraus originais MAIS o déficit deixado
    -- pelo anterior, não é mais um desconto proporcional à conclusão.
    if v_order.service_type in ('win_boost', 'md5') then
      v_new_wins_purchased := coalesce(v_order.wins_purchased, 0) + v_negative_matches;

      -- Preço por vitória REALMENTE vendido neste pedido -- respeita
      -- qualquer desconto de pacote (ELOPEAK30, pacote de 1/3/5 vitórias)
      -- aplicado na compra original. win_value_cents é só o preço cheio por
      -- tier (sem desconto algum) -- usá-lo aqui subestima ou superestima o
      -- valor real dependendo do desconto que o pedido teve. Fallback pro
      -- preço cheio só se wins_purchased estiver ausente/zerado (não deveria
      -- acontecer em win_boost/md5, que sempre vendem por vitória).
      v_price_per_win := case
        when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
        else v_win_cents / 100.0
      end;

      v_new_total_price := round(v_new_wins_purchased * v_price_per_win, 2);
      v_new_estimated_hours := case
        when v_order.wins_purchased is not null and v_order.wins_purchased > 0 and v_order.estimated_hours is not null
          then round(v_order.estimated_hours * v_new_wins_purchased / v_order.wins_purchased, 2)
        else v_order.estimated_hours
      end;
    else -- elo_boost
      v_new_wins_purchased := v_order.wins_purchased; -- elo_boost não usa este campo
      v_price_per_win := v_win_cents / 100.0;
      v_tgt_tier := v_order.target_rank->>'tier';
      v_tgt_div  := v_order.target_rank->>'division';

      v_sub_master_cents := public.calc_elo_price_cents(
        v_order.queue_type::text, v_order.boost_mode,
        v_new_current_rank->>'tier', v_new_current_rank->>'division',
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then 'master' else v_tgt_tier end,
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then null else v_tgt_div end
      );

      v_master_plus_price := 0;
      if v_tgt_tier in ('grandmaster', 'challenger') then
        v_mp_current_tier := case
          when v_new_current_rank->>'tier' in ('master', 'grandmaster', 'challenger') then v_new_current_rank->>'tier'
          else 'master'
        end;
        select price into v_master_plus_price
        from public.master_plus_pricing
        where current_tier = v_mp_current_tier and target_tier = v_tgt_tier
          and queue_type = v_order.queue_type and boost_mode = v_order.boost_mode
        order by pdl_from desc
        limit 1;
        v_master_plus_price := coalesce(v_master_plus_price, 0);
      end if;

      v_new_total_price := round(v_sub_master_cents / 100.0, 2) + v_master_plus_price;
      -- estimated_hours não é recalculado com precisão pro Elo Boost aqui
      -- (dependeria da mesma estimativa por PDL médio/cutoffs de liga da
      -- criação original) -- mantém o valor anterior, é só um campo de
      -- exibição de prazo, não afeta preço/comissão.
      v_new_estimated_hours := v_order.estimated_hours;
    end if;

    -- Taxa de drop: cobre só o trabalho extra que o PRÓPRIO booster causou
    -- (as partidas negativadas), pela comissão dele mesmo (55%/60%) -- não
    -- mais a diferença cheia entre o novo valor do pedido e o que o cliente
    -- pagou. Aquela fórmula cobrava do booster o preço de venda (100%) de
    -- vitórias que o cliente sempre pagaria de qualquer forma (a vitória
    -- original contratada), não só a sua própria falha. Confirmado com o
    -- usuário: só as partidas negativadas, na comissão do booster.
    v_fee_amount     := round(v_negative_matches * v_price_per_win * v_share_pct, 2);
    v_price_changed  := true;
  else
    -- Drop positivo/neutro -- comportamento inalterado.
    v_new_wins_purchased := case
      when v_order.service_type in ('win_boost', 'md5') and v_order.wins_purchased is not null
        then greatest(0, v_order.wins_purchased - coalesce(v_order.wins_played, 0))
      else v_order.wins_purchased
    end;
    v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null
        then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
      else null
    end;
  end if;

  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    total_price            = v_new_total_price,
    base_price             = case when v_price_changed then v_new_total_price else base_price end,
    extras_price           = case when v_price_changed then 0 else extras_price end,
    discount_price         = case when v_price_changed then 0 else discount_price end,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles
    set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial (' || round(v_completion_pct) || '% concluído) pelo pedido '
        || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'Você concluiu ' || round(v_completion_pct) || '% do pedido antes do drop -- R$ '
        || v_payout::text || ' foi creditado ao seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout, 'completion_pct', v_completion_pct)
    );
  end if;

  if v_fee_amount > 0 then
    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
      'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s) a mais de derrota que vitória, '
        || round(v_share_pct * 100) || '% (sua comissão) do valor da vitória no tier atual). '
        || 'O pedido foi reprecificado em R$ ' || v_new_total_price::text
        || ' pra cobrir o trabalho extra pro próximo booster; R$ ' || v_fee_amount::text
        || ' foi descontado do seu saldo, referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Este pedido estava negativado (' || v_negative_matches || ' derrota(s) a mais que vitórias) no drop. '
        || 'Uma taxa de R$ ' || v_fee_amount::text
        || ' (' || round(v_share_pct * 100) || '% do valor da vitória no tier atual, por partida negativada) '
        || 'foi descontada do seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_fee_amount, 'negative_matches', v_negative_matches, 'new_total_price', v_new_total_price)
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
    'completion_pct', v_completion_pct,
    'payout_amount', v_payout,
    'penalty_amount', v_fee_amount,
    'negative_matches', v_negative_matches,
    'new_total_price', v_new_total_price
  );
end;
$function$;

-- ── cancel_order_after_drop_limit: mesmo fix -- win_boost/md5 usa o preço
--    por vitória real do pedido em vez da tabela fixa por tier. Já usava
--    fórmula baseada em comissão (não em "novo total - pago", que nem existe
--    aqui já que o pedido é cancelado, não re-listado) -- só faltava o preço
--    correto. Ganha wins_purchased/total_price no SELECT pra isso.
create or replace function public.cancel_order_after_drop_limit(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requested_by_role drop_requester_role DEFAULT 'admin'::drop_requester_role)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order          record;
  v_completion_pct numeric;
  v_negative_matches integer;
  v_win_cents        integer;
  v_price_per_win    numeric;
  v_is_top3          boolean;
  v_share_pct        numeric := 0;
  v_fee_amount       numeric := 0;
begin
  select id, customer_id, assigned_booster_id, boost_mode, current_rank, service_type, queue_type,
         wins_played, losses_played, wins_purchased, total_price
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('completion_pct', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  update public.orders set
    status     = 'canceled',
    updated_at = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'canceled', p_actor_id, p_reason);

  if v_order.assigned_booster_id is not null then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles where user_id = v_order.assigned_booster_id;
    v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

    v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));
    v_win_cents := case
      when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
        then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
      else 0
    end;
    v_price_per_win := case
      when v_order.service_type in ('win_boost', 'md5') and coalesce(v_order.wins_purchased, 0) > 0
        then v_order.total_price / v_order.wins_purchased
      else v_win_cents / 100.0
    end;
    v_fee_amount := round(v_price_per_win * v_share_pct * v_negative_matches, 2);

    if v_fee_amount > 0 then
      insert into public.booster_ledger_entries(
        booster_id, order_id, entry_type, amount, description, actor_id, actor_role
      ) values (
        v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
        'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s), '
          || round(v_share_pct * 100) || '% (sua comissão) do valor da vitória no tier atual) referente ao pedido '
          || p_order_id::text || ' (cancelado por limite de drops)',
        p_actor_id, 'admin'::public.user_role
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_dropped_by_admin', 'Pedido cancelado pelo admin',
      'Este pedido atingiu o limite de 2 drops e foi cancelado por um administrador. Motivo: ' || p_reason
        || case when v_fee_amount > 0
             then '. Uma taxa de R$ ' || v_fee_amount::text || ' foi descontada do seu saldo (pedido negativado).'
             else '. Nosso time vai falar com você individualmente sobre o pagamento.'
           end,
      jsonb_build_object('order_id', p_order_id, 'penalty_amount', v_fee_amount)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido atingiu o limite de 2 drops e foi cancelado. Nosso time vai entrar em contato para resolver individualmente.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('completion_pct', v_completion_pct, 'penalty_amount', v_fee_amount);
end;
$function$;
