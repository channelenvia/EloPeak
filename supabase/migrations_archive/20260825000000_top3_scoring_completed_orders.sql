-- Reformula o score de performance (refresh_booster_performance_segments) e
-- o portão de elegibilidade do Top 3 (refresh_top3_boosters), a pedido
-- explícito: winrate/KDA/pedidos concluídos devem ser o que PRINCIPALMENTE
-- conta, avaliação entra depois (só se existir, sem inventar nota via prior
-- Bayesiano), e booster sem pedido concluído suficiente não pode estar no
-- Top 3 -- hoje o portão era só "total_matches > 0" (PARTIDA individual, não
-- pedido concluído), permissivo demais.
--
-- Pesos novos (somam 100% quando há avaliação real; sem avaliação, os 3
-- primeiros são renormalizados pra continuar somando 100%):
--   45% Win Rate (Wilson score, já existia)  + 30% KDA (já existia)
--   + 15% Pedidos Concluídos (novo, capado em 30 -- teto arbitrário
--     documentado aqui: ~1 pedido/dia por 1 mês é "booster muito ativo",
--     fácil de recalibrar mudando só a constante completed_orders_cap)
--   + 10% Nota média real (sem o prior de 4.5 usado até aqui -- só entra
--     quando review_count > 0; column adjusted_rating passa a guardar a
--     média real em vez do valor Bayesiano)
--
-- score_version sobe pra 'v2' (rastreável -- só get_top_boosters/discord-
-- top3-announcement leem o valor calculado, nenhum decide com base na
-- STRING da versão).
create or replace function public.refresh_booster_performance_segments(p_booster_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  w_winrate constant numeric := 0.45;
  w_kda     constant numeric := 0.30;
  w_completed constant numeric := 0.15;
  w_rating  constant numeric := 0.10;
  completed_orders_cap constant numeric := 30;
  wilson_z constant numeric := 1.96;
begin
  delete from public.booster_performance_segments
  where p_booster_id is null or booster_id = p_booster_id;

  delete from public.booster_champion_stats
  where p_booster_id is null or booster_id = p_booster_id;

  with match_source as (
    select
      o.assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      m.result, m.kills, m.deaths, m.assists, m.duration_seconds,
      m.minions_killed, m.neutral_minions_killed, m.is_mvp, m.champion, m.played_at,
      m.vision_score
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null and o.boost_mode <> 'duo'
    union all
    select
      o.assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      d.result, d.kills, d.deaths, d.assists, d.duration_seconds,
      d.minions_killed, d.neutral_minions_killed, d.is_mvp, d.champion, d.played_at,
      d.vision_score
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where o.assigned_booster_id is not null and o.boost_mode = 'duo'
  ),
  match_stats as (
    select
      ms.assigned_booster_id as booster_id,
      ms.service_type::text as service_type,
      public.rank_bucket_of(ms.current_rank->>'tier') as rank_bucket,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      ms.queue_type::text as queue_type,
      count(*) as total_matches,
      count(*) filter (where ms.result = 'win') as wins,
      count(*) filter (where ms.result = 'loss') as losses,
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)) as average_kda,
      avg(
        case when ms.duration_seconds > 0 and ms.minions_killed is not null
          then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end
      ) as avg_cs_per_min,
      avg(ms.vision_score) as avg_vision_score,
      count(*) filter (where ms.is_mvp) as mvp_count,
      max(ms.played_at) as last_match_at
    from match_source ms
    where p_booster_id is null or ms.assigned_booster_id = p_booster_id
    group by grouping sets (
      (ms.assigned_booster_id, ms.service_type, public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, ms.service_type),
      (ms.assigned_booster_id),
      (ms.assigned_booster_id, account_type),
      (ms.assigned_booster_id, account_type, public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, account_type, ms.queue_type::text),
      (ms.assigned_booster_id, public.rank_bucket_of(ms.current_rank->>'tier'))
    )
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
      r.booster_id,
      o.service_type::text as service_type,
      public.rank_bucket_of(o.current_rank->>'tier') as rank_bucket,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      o.queue_type::text as queue_type,
      count(*) as review_count,
      avg(r.rating) as average_rating
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true
      and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
    group by grouping sets (
      (r.booster_id, o.service_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, o.service_type),
      (r.booster_id),
      (r.booster_id, account_type),
      (r.booster_id, account_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, account_type, o.queue_type::text),
      (r.booster_id, public.rank_bucket_of(o.current_rank->>'tier'))
    )
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
  -- Pedidos CONCLUÍDOS (orders.status='completed'), não partidas -- métrica
  -- nova pedida explicitamente pro score e pro portão do Top 3. Mesmo padrão
  -- de grouping sets das duas CTEs acima, pra combinar nas mesmas
  -- granularidades (service_type/rank_bucket/account_type/queue_type).
  completed_order_source as (
    select o.assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type
    from public.orders o
    where o.assigned_booster_id is not null
      and o.status = 'completed'
      and (p_booster_id is null or o.assigned_booster_id = p_booster_id)
  ),
  completed_order_stats as (
    select
      cos.assigned_booster_id as booster_id,
      cos.service_type::text as service_type,
      public.rank_bucket_of(cos.current_rank->>'tier') as rank_bucket,
      case when cos.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      cos.queue_type::text as queue_type,
      count(*) as completed_orders
    from completed_order_source cos
    group by grouping sets (
      (cos.assigned_booster_id, cos.service_type, public.rank_bucket_of(cos.current_rank->>'tier')),
      (cos.assigned_booster_id, cos.service_type),
      (cos.assigned_booster_id),
      (cos.assigned_booster_id, account_type),
      (cos.assigned_booster_id, account_type, public.rank_bucket_of(cos.current_rank->>'tier')),
      (cos.assigned_booster_id, account_type, cos.queue_type::text),
      (cos.assigned_booster_id, public.rank_bucket_of(cos.current_rank->>'tier'))
    )
  ),
  completed_order_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      completed_orders
    from completed_order_stats
  ),
  merged as (
    select
      coalesce(m.booster_id, r.booster_id, c.booster_id) as booster_id,
      coalesce(m.service_type, r.service_type, c.service_type) as service_type,
      coalesce(m.rank_bucket, r.rank_bucket, c.rank_bucket) as rank_bucket,
      coalesce(m.account_type, r.account_type, c.account_type) as account_type,
      coalesce(m.queue_type, r.queue_type, c.queue_type) as queue_type,
      coalesce(m.total_matches, 0) as total_matches,
      coalesce(m.wins, 0) as wins,
      coalesce(m.losses, 0) as losses,
      m.average_kda,
      m.avg_cs_per_min,
      m.avg_vision_score,
      coalesce(m.mvp_count, 0) as mvp_count,
      m.last_match_at,
      coalesce(r.review_count, 0) as review_count,
      r.average_rating,
      coalesce(c.completed_orders, 0) as completed_orders
    from match_stats_normalized m
    full outer join review_stats_normalized r
      on r.booster_id = m.booster_id
     and r.service_type = m.service_type
     and r.rank_bucket = m.rank_bucket
     and r.account_type = m.account_type
     and r.queue_type = m.queue_type
    full outer join completed_order_stats_normalized c
      on c.booster_id = coalesce(m.booster_id, r.booster_id)
     and c.service_type = coalesce(m.service_type, r.service_type)
     and c.rank_bucket = coalesce(m.rank_bucket, r.rank_bucket)
     and c.account_type = coalesce(m.account_type, r.account_type)
     and c.queue_type = coalesce(m.queue_type, r.queue_type)
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
      least(completed_orders, completed_orders_cap) / completed_orders_cap as normalized_completed_calc,
      (review_count > 0) as has_rating
    from merged
  ),
  final as (
    select
      *,
      (w_winrate * adjusted_win_rate_calc + w_kda * normalized_kda_calc + w_completed * normalized_completed_calc) as base_score_calc
    from scored
  )
  insert into public.booster_performance_segments (
    booster_id, service_type, rank_bucket, account_type, queue_type,
    total_matches, wins, losses,
    adjusted_win_rate, average_kda, normalized_kda,
    avg_cs_per_min, avg_vision_score, mvp_count,
    review_count, average_rating, adjusted_rating,
    completed_orders,
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
    round(average_rating::numeric, 2),
    completed_orders,
    round((
      case when has_rating
        then base_score_calc + w_rating * (average_rating / 5)
        else base_score_calc / (w_winrate + w_kda + w_completed)
      end
    ) * 100, 2) as performance_score,
    'v2',
    last_match_at,
    now(),
    now()
  from final
  where total_matches > 0 or review_count > 0 or completed_orders > 0;

  with match_source as (
    select o.assigned_booster_id, o.boost_mode, m.champion, m.result
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null and o.boost_mode <> 'duo' and m.champion is not null
    union all
    select o.assigned_booster_id, o.boost_mode, d.champion, d.result
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where o.assigned_booster_id is not null and o.boost_mode = 'duo' and d.champion is not null
  ),
  champion_stats as (
    select
      ms.assigned_booster_id as booster_id,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      ms.champion,
      count(*) as games_played,
      count(*) filter (where ms.result = 'win') as wins
    from match_source ms
    where p_booster_id is null or ms.assigned_booster_id = p_booster_id
    group by grouping sets (
      (ms.assigned_booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), ms.champion),
      (ms.assigned_booster_id, ms.champion)
    )
  )
  insert into public.booster_champion_stats (booster_id, account_type, champion, games_played, wins, calculated_at)
  select booster_id, coalesce(account_type, '__all__'), champion, games_played, wins, now()
  from champion_stats;
end;
$$;

revoke all on function public.refresh_booster_performance_segments(uuid) from public, anon, authenticated;
grant execute on function public.refresh_booster_performance_segments(uuid) to service_role;

alter table public.booster_performance_segments
  add column if not exists completed_orders integer not null default 0;

-- adjusted_rating era NOT NULL porque a fórmula antiga sempre produzia um
-- valor via prior Bayesiano (mesmo sem nenhuma review real). A fórmula nova
-- não inventa nota -- quando review_count = 0, average_rating/adjusted_rating
-- ficam null de propósito (sem avaliação real, sem número fake pra mostrar).
alter table public.booster_performance_segments
  alter column adjusted_rating drop not null;

-- Portão do Top 3: exige pelo menos 10 pedidos concluídos (valor pedido
-- explicitamente) -- antes só exigia total_matches > 0 (1 partida já
-- bastava). Continua só na linha __all__/__all__/__all__/__all__ (o
-- agregado geral do booster, mesma âncora de antes).
create or replace function public.refresh_top3_boosters()
returns void
language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare
  v_top3_ids uuid[];
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  select array_agg(sub.booster_id) into v_top3_ids
  from (
    select bps.booster_id
    from   public.booster_performance_segments bps
    join   public.booster_profiles bp on bp.user_id = bps.booster_id
    where  bps.service_type = '__all__'
      and  bps.rank_bucket = '__all__'
      and  bps.account_type = '__all__'
      and  bps.queue_type = '__all__'
      and  bp.status = 'approved'
      and  bps.completed_orders >= 10
    order  by bps.performance_score desc, bps.completed_orders desc, bps.booster_id
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;

-- Repopula com a fórmula nova (idempotente -- delete+insert por booster).
select public.refresh_booster_performance_segments(null);
select public.refresh_top3_boosters();
