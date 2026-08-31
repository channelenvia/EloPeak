-- Fecha uma lacuna aberta pela liberação de Duo Boost em Master+ na fila
-- Flex (migration 20260830110000): duas tabelas/funções em Postgres eram
-- cópias fiéis de preços do TS assumindo que "Duo nunca chega em Master+"
-- -- essa premissa não vale mais.
--
-- 1) win_penalty_price_cents (valor de uma vitória avulsa, usado em
--    win_value_cents pra calcular taxa de drop negativado) não tinha as
--    linhas duo/grandmaster e duo/challenger -- só existiam pra solo. Sem
--    elas, win_value_cents caía no fallback pro preço de 'master' do mesmo
--    modo (R$85,15), subcobrando a taxa de drop de um pedido Duo Flex em
--    GM/Challenger.
--
-- 2) apply_order_drop (reprecificação de Elo Boost dropado negativado) só
--    consultava master_plus_pricing quando boost_mode = 'solo' -- Duo nunca
--    precisava do trecho Mestre->alvo porque nunca chegava lá. Agora que
--    chega (só na Flex), esse gate pulava o segmento Master+ inteiro pra
--    pedidos Duo, zerando aquela parte do preço. A própria consulta também
--    não filtrava por boost_mode -- com solo e duo agora dividindo a mesma
--    chave (tier atual, tier alvo, fila, degrau de PDL), um "limit 1" sem
--    esse filtro pode pegar a linha errada.

insert into public.win_penalty_price_cents (queue_type, boost_mode, tier, price_cents)
select queue_type, 'duo', tier, price_cents
from (values ('grandmaster', 12590), ('challenger', 21090)) as v(tier, price_cents)
cross join (values ('solo_duo'), ('flex')) as q(queue_type)
on conflict (queue_type, boost_mode, tier) do nothing;

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
  v_customer_paid       numeric;
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
    if v_order.service_type in ('win_boost', 'md5') then
      v_new_wins_purchased := coalesce(v_order.wins_purchased, 0) + v_negative_matches;
      v_new_total_price := round((v_new_wins_purchased * v_win_cents) / 100.0, 2);
      v_new_estimated_hours := case
        when v_order.wins_purchased is not null and v_order.wins_purchased > 0 and v_order.estimated_hours is not null
          then round(v_order.estimated_hours * v_new_wins_purchased / v_order.wins_purchased, 2)
        else v_order.estimated_hours
      end;
    else
      v_new_wins_purchased := v_order.wins_purchased;
      v_tgt_tier := v_order.target_rank->>'tier';
      v_tgt_div  := v_order.target_rank->>'division';

      v_sub_master_cents := public.calc_elo_price_cents(
        v_order.queue_type::text, v_order.boost_mode,
        v_new_current_rank->>'tier', v_new_current_rank->>'division',
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then 'master' else v_tgt_tier end,
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then null else v_tgt_div end
      );

      -- Fix: o trecho Mestre->alvo agora existe pra Duo também (só na fila
      -- Flex, master_plus_pricing tem preço próprio -- migration
      -- 20260830110000), então não pode mais pular pra Duo. A consulta
      -- ganha o filtro boost_mode -- sem ele, um "limit 1" ficaria ambíguo
      -- entre a linha solo e a linha duo da mesma chave (tier atual, tier
      -- alvo, fila, degrau de PDL).
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
      v_new_estimated_hours := v_order.estimated_hours;
    end if;

    select coalesce(sum(amount), 0) into v_customer_paid
    from public.payments
    where order_id = p_order_id and status = 'paid'::public.payment_status;

    v_fee_amount   := greatest(0, v_new_total_price - v_customer_paid);
    v_price_changed := true;
  else
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
      'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s) a mais de derrota que vitória). '
        || 'O pedido foi reprecificado em R$ ' || v_new_total_price::text
        || '; R$ ' || v_fee_amount::text || ' (diferença entre o novo valor e o que o cliente pagou) '
        || 'foi descontado do seu saldo, referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Este pedido estava negativado (' || v_negative_matches || ' derrota(s) a mais que vitórias) no drop. '
        || 'O pedido foi reprecificado e uma taxa de R$ ' || v_fee_amount::text
        || ' foi descontada do seu saldo para cobrir a diferença.',
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
