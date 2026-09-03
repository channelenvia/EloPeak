-- Bug real: refresh_booster_performance_segments() (chamada pelo trigger
-- reviews_refresh_booster_rating a cada insert/update/delete em reviews)
-- gera as linhas "por rank"/"por queue_type" via GROUPING SETS, junto com
-- linhas mais gerais que não agrupam por essas dimensões. Pedidos de
-- coaching nunca têm current_rank nem queue_type preenchidos -- então
-- rank_bucket_of(null) cai no fallback '__all__', e a linha do grouping set
-- "(booster_id, service_type, rank_bucket)" fica com a MESMA chave
-- normalizada (booster_id, service_type, '__all__', account_type,
-- '__all__') que a linha do grouping set mais simples "(booster_id,
-- service_type)" (cujo rank_bucket ausente também normaliza pra '__all__'
-- via coalesce). As duas linhas -- idênticas em valor, já que agregam
-- exatamente a mesma partição de partidas/reviews -- disparam "duplicate
-- key value violates unique constraint booster_performance_segments_segment_key"
-- no INSERT final, derrubando a transação inteira (inclusive a review que
-- disparou o trigger -- é por isso que "Avaliar booster" falhava pra
-- pedidos de coaching).
--
-- Fix: deduplicar match_stats_normalized/review_stats_normalized pela
-- chave completa (booster_id, service_type, rank_bucket, account_type,
-- queue_type) antes do full outer join -- linhas duplicadas por essa
-- colisão são sempre idênticas em valor (mesma partição), então DISTINCT ON
-- não perde informação nenhuma.

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
    -- Solo Boost -- m.booster_id é quem estava atribuído QUANDO a partida foi
    -- registrada (capturado em record_order_match), não o atribuído atual.
    select
      m.booster_id as assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      m.result, m.kills, m.deaths, m.assists, m.duration_seconds,
      m.minions_killed, m.neutral_minions_killed, m.is_mvp, m.champion, m.played_at,
      m.vision_score
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where m.booster_id is not null and o.boost_mode <> 'duo' and m.result in ('win', 'loss')
    union all
    -- Duo Boost -- d.booster_id já era capturado corretamente no insert
    -- (migration 149); o bug era usar o.assigned_booster_id aqui em vez dele.
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
  match_stats_raw_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      total_matches, wins, losses, average_kda, avg_cs_per_min, avg_vision_score, mvp_count, last_match_at
    from match_stats
  ),
  match_stats_normalized as (
    -- Dedup pela chave completa -- grouping sets que "colapsam" pra mesma
    -- combinação normalizada (ex.: rank_bucket sempre '__all__' porque
    -- current_rank é sempre null) produzem linhas idênticas em valor;
    -- qualquer uma serve.
    select distinct on (booster_id, service_type, rank_bucket, account_type, queue_type)
      booster_id, service_type, rank_bucket, account_type, queue_type,
      total_matches, wins, losses, average_kda, avg_cs_per_min, avg_vision_score, mvp_count, last_match_at
    from match_stats_raw_normalized
    order by booster_id, service_type, rank_bucket, account_type, queue_type
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
  review_stats_raw_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      review_count, average_rating
    from review_stats
  ),
  review_stats_normalized as (
    select distinct on (booster_id, service_type, rank_bucket, account_type, queue_type)
      booster_id, service_type, rank_bucket, account_type, queue_type,
      review_count, average_rating
    from review_stats_raw_normalized
    order by booster_id, service_type, rank_bucket, account_type, queue_type
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
