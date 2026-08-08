-- Separa duas coisas que estavam misturadas numa fonte só (order_matches):
--
--   1. Histórico/progresso DO PEDIDO -- sempre a conta do CLIENTE
--      (order.riot_id), é o produto sendo entregue (rank/vitórias daquela
--      conta), independente de solo ou Duo Boost.
--   2. Estatísticas DO BOOSTER (campeão, KDA, farm, MVP no perfil público)
--      -- em Solo Boost o booster joga NA conta do cliente, então
--      order_matches já reflete o jogo dele. Em Duo Boost o booster joga
--      numa conta SEPARADA (duo_accounts ou duo_own_riot_id) -- são dois
--      jogadores diferentes na mesma partida, com campeão/KDA diferentes.
--      Usar order_matches (conta do cliente) pras stats do booster em Duo
--      mostraria o campeão/KDA do CLIENTE como se fosse do booster.
--
-- booster_duo_matches guarda só o lado do booster nas partidas de Duo Boost
-- -- refresh_booster_performance_segments passa a ler de uma fonte ou outra
-- dependendo de boost_mode, nunca as duas juntas pro mesmo pedido.
create table public.booster_duo_matches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  booster_id uuid not null references public.booster_profiles(user_id) on delete cascade,
  external_match_id text not null,
  result text not null check (result in ('win', 'loss')),
  champion text,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  queue_id integer,
  duration_seconds integer,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  minions_killed integer,
  neutral_minions_killed integer,
  is_mvp boolean not null default false,
  unique (order_id, external_match_id)
);

create index booster_duo_matches_order_idx on public.booster_duo_matches(order_id, played_at desc);
create index booster_duo_matches_booster_idx on public.booster_duo_matches(booster_id, played_at desc);

alter table public.booster_duo_matches enable row level security;

-- Mesmo padrão de leitura de order_matches (migration 052): admin, cliente
-- ou booster do pedido.
create policy "booster_duo_matches_read" on public.booster_duo_matches for select using (
  public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.id = booster_duo_matches.order_id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  )
);

revoke all on public.booster_duo_matches from public, anon;
grant select on public.booster_duo_matches to authenticated;
grant insert, select, update, delete on public.booster_duo_matches to service_role;

-- ─── refresh_booster_performance_segments: lê de order_matches (solo) OU
-- booster_duo_matches (duo), nunca as duas pro mesmo pedido ─────────────────

create or replace function public.refresh_booster_performance_segments(p_booster_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
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
    -- Solo Boost -- o booster jogou DIRETO na conta do cliente, order_matches
    -- já é o jogo dele.
    select
      o.assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      m.result, m.kills, m.deaths, m.assists, m.duration_seconds,
      m.minions_killed, m.neutral_minions_killed, m.is_mvp, m.champion, m.played_at
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null and o.boost_mode <> 'duo'
    union all
    -- Duo Boost -- o booster jogou numa conta separada (pool da plataforma
    -- ou própria); booster_duo_matches é o lado dele, não o do cliente.
    select
      o.assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      d.result, d.kills, d.deaths, d.assists, d.duration_seconds,
      d.minions_killed, d.neutral_minions_killed, d.is_mvp, d.champion, d.played_at
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
      (ms.assigned_booster_id, account_type, ms.queue_type::text)
    )
  ),
  match_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      total_matches, wins, losses, average_kda, avg_cs_per_min, mvp_count, last_match_at
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
      (r.booster_id, account_type, o.queue_type::text)
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
    avg_cs_per_min, mvp_count,
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

-- Repopula tudo com a fonte correta por modo (idempotente).
select public.refresh_booster_performance_segments(null);
