-- Achado do /code-review em cima da 20260829150000: o filtro
-- `current_rank->>'tier' is not null` só exclui tier NULL do branch que
-- quebra por rank_bucket -- mas rank_bucket_of() também cai em '__all__'
-- pra QUALQUER tier não-nulo só que desconhecido (dado velho, um tier novo
-- do Riot ainda não adicionado no CASE de rank_bucket_of, etc), já que
-- current_rank é jsonb sem CHECK constraint no banco. Nesse caso a partida
-- ainda entra no branch 2 com rank_bucket_of(...) = '__all__', colidindo
-- com a linha "sem quebra por rank" do branch 1 -- exatamente o crash que
-- essa cadeia de 3 migrations (120000 -> dedup -> 150000) existe pra
-- eliminar.
--
-- Fix de raiz: filtra pelo resultado de rank_bucket_of(...) <> '__all__'
-- em vez do campo bruto -- dessa forma, TODO tier que caia no fallback
-- (nulo, vazio ou desconhecido) fica de fora do branch quebrado por rank,
-- não só o nulo.
create or replace function public.refresh_booster_performance_segments(p_booster_id uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  w_winrate constant numeric := 0.45;
  w_kda     constant numeric := 0.30;
  w_rating  constant numeric := 0.25;
  rating_prior        constant numeric := 4.5;
  rating_prior_weight constant numeric := 10;
  wilson_z constant numeric := 1.96;
begin
  delete from public.booster_performance_segments
  where p_booster_id is null or booster_id = p_booster_id;

  delete from public.booster_champion_stats
  where p_booster_id is null or booster_id = p_booster_id;

  with match_source as (
    select
      m.booster_id as assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      m.result, m.kills, m.deaths, m.assists, m.duration_seconds,
      m.minions_killed, m.neutral_minions_killed, m.is_mvp, m.champion, m.played_at,
      m.vision_score
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where m.booster_id is not null and o.boost_mode <> 'duo' and m.result in ('win', 'loss')
    union all
    select
      d.booster_id as assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      d.result, d.kills, d.deaths, d.assists, d.duration_seconds,
      d.minions_killed, d.neutral_minions_killed, d.is_mvp, d.champion, d.played_at,
      d.vision_score
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where d.booster_id is not null and o.boost_mode = 'duo' and d.result in ('win', 'loss')
  ),
  match_stats as (
    select
      ms.assigned_booster_id as booster_id, ms.service_type::text as service_type,
      null::text as rank_bucket,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      null::text as queue_type,
      count(*) as total_matches,
      count(*) filter (where ms.result = 'win') as wins,
      count(*) filter (where ms.result = 'loss') as losses,
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)) as average_kda,
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end) as avg_cs_per_min,
      avg(ms.vision_score) as avg_vision_score,
      count(*) filter (where ms.is_mvp) as mvp_count,
      max(ms.played_at) as last_match_at
    from match_source ms
    where p_booster_id is null or ms.assigned_booster_id = p_booster_id
    group by grouping sets (
      (ms.assigned_booster_id, ms.service_type),
      (ms.assigned_booster_id),
      (ms.assigned_booster_id, account_type)
    )

    union all

    select
      ms.assigned_booster_id, ms.service_type::text,
      public.rank_bucket_of(ms.current_rank->>'tier'),
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end,
      null::text,
      count(*),
      count(*) filter (where ms.result = 'win'),
      count(*) filter (where ms.result = 'loss'),
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)),
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end),
      avg(ms.vision_score),
      count(*) filter (where ms.is_mvp),
      max(ms.played_at)
    from match_source ms
    where (p_booster_id is null or ms.assigned_booster_id = p_booster_id)
      and public.rank_bucket_of(ms.current_rank->>'tier') <> '__all__'
    group by grouping sets (
      (ms.assigned_booster_id, ms.service_type, public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, public.rank_bucket_of(ms.current_rank->>'tier'))
    )

    union all

    select
      ms.assigned_booster_id, null::text,
      null::text,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end,
      ms.queue_type::text,
      count(*),
      count(*) filter (where ms.result = 'win'),
      count(*) filter (where ms.result = 'loss'),
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)),
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end),
      avg(ms.vision_score),
      count(*) filter (where ms.is_mvp),
      max(ms.played_at)
    from match_source ms
    where (p_booster_id is null or ms.assigned_booster_id = p_booster_id)
      and ms.queue_type is not null
    group by ms.assigned_booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), ms.queue_type::text
  ),
  match_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      total_matches, wins, losses, average_kda, avg_cs_per_min, avg_vision_score, mvp_count, last_match_at
    from match_stats
  ),
  review_stats as (
    select
      r.booster_id, o.service_type::text as service_type,
      null::text as rank_bucket,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      null::text as queue_type,
      count(*) as review_count,
      avg(r.rating) as average_rating
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
    group by grouping sets (
      (r.booster_id, o.service_type),
      (r.booster_id),
      (r.booster_id, account_type)
    )

    union all

    select
      r.booster_id, o.service_type::text,
      public.rank_bucket_of(o.current_rank->>'tier'),
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end,
      null::text,
      count(*),
      avg(r.rating)
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
      and public.rank_bucket_of(o.current_rank->>'tier') <> '__all__'
    group by grouping sets (
      (r.booster_id, o.service_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, (case when o.boost_mode = 'duo' then 'duo' else 'solo' end), public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, public.rank_bucket_of(o.current_rank->>'tier'))
    )

    union all

    select
      r.booster_id, null::text,
      null::text,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end,
      o.queue_type::text,
      count(*),
      avg(r.rating)
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
      and o.queue_type is not null
    group by r.booster_id, (case when o.boost_mode = 'duo' then 'duo' else 'solo' end), o.queue_type::text
  ),
  review_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      review_count, average_rating
    from review_stats
  ),
  merged as (
    select
      coalesce(m.booster_id, r.booster_id) as booster_id,
      coalesce(m.service_type, r.service_type) as service_type,
      coalesce(m.rank_bucket, r.rank_bucket) as rank_bucket,
      coalesce(m.account_type, r.account_type) as account_type,
      coalesce(m.queue_type, r.queue_type) as queue_type,
      coalesce(m.total_matches, 0) as total_matches,
      coalesce(m.wins, 0) as wins,
      coalesce(m.losses, 0) as losses,
      m.average_kda,
      m.avg_cs_per_min,
      m.avg_vision_score,
      coalesce(m.mvp_count, 0) as mvp_count,
      m.last_match_at,
      coalesce(r.review_count, 0) as review_count,
      r.average_rating
    from match_stats_normalized m
    full outer join review_stats_normalized r
      on r.booster_id = m.booster_id
     and r.service_type = m.service_type
     and r.rank_bucket = m.rank_bucket
     and r.account_type = m.account_type
     and r.queue_type = m.queue_type
  ),
  scored as (
    select
      *,
      case when total_matches = 0 then 0::numeric else
        (
          (wins::numeric / total_matches) + (wilson_z ^ 2) / (2 * total_matches::numeric)
          - wilson_z * sqrt(
              ((wins::numeric / total_matches) * (1 - wins::numeric / total_matches) / total_matches::numeric)
              + (wilson_z ^ 2) / (4 * (total_matches::numeric ^ 2))
            )
        ) / (1 + (wilson_z ^ 2) / total_matches::numeric)
      end as adjusted_win_rate_calc,
      coalesce(least(average_kda, 10) / 10, 0) as normalized_kda_calc,
      (review_count * coalesce(average_rating, rating_prior) + rating_prior_weight * rating_prior)
        / (review_count + rating_prior_weight) as adjusted_rating_calc
    from merged
  )
  insert into public.booster_performance_segments (
    booster_id, service_type, rank_bucket, account_type, queue_type,
    total_matches, wins, losses,
    adjusted_win_rate, average_kda, normalized_kda,
    avg_cs_per_min, avg_vision_score, mvp_count,
    review_count, average_rating, adjusted_rating,
    performance_score, score_version, last_match_at, calculated_at, updated_at
  )
  select
    booster_id, service_type, rank_bucket, account_type, queue_type,
    total_matches, wins, losses,
    adjusted_win_rate_calc,
    average_kda,
    normalized_kda_calc,
    avg_cs_per_min,
    avg_vision_score,
    mvp_count,
    review_count,
    round(average_rating::numeric, 2),
    adjusted_rating_calc,
    round((
      w_winrate * adjusted_win_rate_calc
      + w_kda * normalized_kda_calc
      + w_rating * (adjusted_rating_calc / 5)
    ) * 100, 2) as performance_score,
    'v1',
    last_match_at,
    now(),
    now()
  from scored
  where total_matches > 0 or review_count > 0;

  with match_source as (
    select m.booster_id, o.boost_mode, m.champion, m.result
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where m.booster_id is not null and o.boost_mode <> 'duo' and m.champion is not null and m.result in ('win', 'loss')
    union all
    select d.booster_id, o.boost_mode, d.champion, d.result
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where d.booster_id is not null and o.boost_mode = 'duo' and d.champion is not null and d.result in ('win', 'loss')
  ),
  champion_stats as (
    select
      ms.booster_id,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      ms.champion,
      count(*) as games_played,
      count(*) filter (where ms.result = 'win') as wins
    from match_source ms
    where p_booster_id is null or ms.booster_id = p_booster_id
    group by grouping sets (
      (ms.booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), ms.champion),
      (ms.booster_id, ms.champion)
    )
  )
  insert into public.booster_champion_stats (booster_id, account_type, champion, games_played, wins, calculated_at)
  select booster_id, coalesce(account_type, '__all__'), champion, games_played, wins, now()
  from champion_stats;
end;
$function$;

-- Achado secundário do mesmo /code-review: coalesce(v_customer_paid, 0) em
-- apply_order_drop virou código morto -- a query que popula v_customer_paid
-- já garante não-nulo via coalesce(sum(amount), 0) própria. Sem efeito de
-- comportamento, só remove a leitura confusa.
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

      v_master_plus_price := 0;
      if v_tgt_tier in ('grandmaster', 'challenger') and v_order.boost_mode = 'solo' then
        v_mp_current_tier := case
          when v_new_current_rank->>'tier' in ('master', 'grandmaster', 'challenger') then v_new_current_rank->>'tier'
          else 'master'
        end;
        select price into v_master_plus_price
        from public.master_plus_pricing
        where current_tier = v_mp_current_tier and target_tier = v_tgt_tier and queue_type = v_order.queue_type
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
