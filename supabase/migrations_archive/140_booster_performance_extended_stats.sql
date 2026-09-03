-- Estende o histórico de partidas e o rollup de performance do booster com:
--   1. Farm (CS/min) e MVP por partida — derivados da MESMA resposta do
--      match-v5 que sync-order-matches já busca, sem chamada extra à Riot.
--      MVP = booster teve o maior KDA entre os 5 jogadores do próprio time
--      naquela partida (empate conta como MVP para ambos).
--   2. Uma dimensão nova em booster_performance_segments -- account_type
--      ('solo' | 'duo' | '__all__'), derivada de orders.boost_mode -- e
--      queue_type ('solo_duo' | 'flex' | '__all__'), de orders.queue_type.
--      Só cobrimos as combinações que o dashboard (spec
--      2026-08-03-booster-performance-stats-design.md) realmente consulta:
--      geral, por account_type, e account_type cruzado com UM filtro por
--      vez (rank OU fila) -- não todo o produto cartesiano.
--   3. booster_champion_stats -- top campeões por account_type, mesmo ciclo
--      de refresh de booster_performance_segments (sem novo ponto de chamada).
--
-- Partidas já sincronizadas antes desta migration mantêm is_mvp=false e CS
-- null (avg() ignora null, então elas simplesmente não entram na média de
-- farm/min -- não há backfill, decisão explícita do spec).

alter table public.order_matches
  add column minions_killed integer,
  add column neutral_minions_killed integer,
  add column is_mvp boolean not null default false;

-- Postgres identifica funções por nome+tipos dos parâmetros -- um
-- CREATE OR REPLACE com uma lista de parâmetros diferente cria uma
-- SOBRECARGA nova, não substitui a antiga. Sem este DROP explícito, o
-- 10-arg antigo ficaria morto (e ambíguo pro PostgREST) ao lado do 13-arg novo.
drop function if exists public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz);

create or replace function public.record_order_match(
  p_order_id uuid,
  p_external_match_id text,
  p_result text,
  p_champion text,
  p_kills integer,
  p_deaths integer,
  p_assists integer,
  p_queue_id integer,
  p_duration_seconds integer,
  p_played_at timestamptz,
  p_minions_killed integer,
  p_neutral_minions_killed integer,
  p_is_mvp boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  insert into public.order_matches(
    order_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp
  ) values (
    p_order_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  if v_inserted then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    else
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean) to service_role;

-- ─── booster_performance_segments: novas dimensões e métricas ─────────────

alter table public.booster_performance_segments
  add column account_type text not null default '__all__',
  add column queue_type text not null default '__all__',
  add column avg_cs_per_min numeric(6,2),
  add column mvp_count integer not null default 0;

-- O nome da constraint unique original (migration 054) é gerado
-- automaticamente pelo Postgres e pode ter sido truncado (limite de 63
-- caracteres) -- em vez de arriscar um nome errado, localiza a única
-- constraint unique da tabela dinamicamente antes de trocá-la.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.booster_performance_segments'::regclass
    and contype = 'u';
  if v_constraint_name is not null then
    execute format('alter table public.booster_performance_segments drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.booster_performance_segments
  add constraint booster_performance_segments_segment_key
  unique (booster_id, account_type, service_type, rank_bucket, queue_type);

create table public.booster_champion_stats (
  id uuid primary key default gen_random_uuid(),
  booster_id uuid not null references public.booster_profiles(user_id) on delete cascade,
  account_type text not null default '__all__',
  champion text not null,
  games_played integer not null default 0,
  wins integer not null default 0,
  calculated_at timestamptz not null default now(),
  unique (booster_id, account_type, champion)
);

create index booster_champion_stats_lookup_idx
  on public.booster_champion_stats(booster_id, account_type, games_played desc);

alter table public.booster_champion_stats enable row level security;

-- Mesmo padrão de booster_performance_segments: leitura pública (dado de
-- perfil, não sensível), escrita só pela função de refresh (security
-- definer).
create policy "booster_champion_stats_read" on public.booster_champion_stats
  for select using (true);

revoke all on public.booster_champion_stats from public, anon, authenticated;
grant select on public.booster_champion_stats to anon, authenticated;

-- ─── refresh_booster_performance_segments: reescrita com as dimensões novas ─

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

  with match_stats as (
    select
      o.assigned_booster_id as booster_id,
      o.service_type::text as service_type,
      public.rank_bucket_of(o.current_rank->>'tier') as rank_bucket,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      o.queue_type::text as queue_type,
      count(*) as total_matches,
      count(*) filter (where m.result = 'win') as wins,
      count(*) filter (where m.result = 'loss') as losses,
      avg((m.kills + m.assists)::numeric / greatest(1, m.deaths)) as average_kda,
      avg(
        case when m.duration_seconds > 0 and m.minions_killed is not null
          then (coalesce(m.minions_killed, 0) + coalesce(m.neutral_minions_killed, 0))::numeric / (m.duration_seconds / 60.0)
        end
      ) as avg_cs_per_min,
      count(*) filter (where m.is_mvp) as mvp_count,
      max(m.played_at) as last_match_at
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null
      and (p_booster_id is null or o.assigned_booster_id = p_booster_id)
    group by grouping sets (
      -- As 3 combinações originais (migration 054) -- account_type/queue_type
      -- ficam '__all__' aqui, então continuam batendo exatamente com as
      -- consultas existentes (Top 3, perfil público) sem mudar nada nelas.
      (o.assigned_booster_id, o.service_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (o.assigned_booster_id, o.service_type),
      (o.assigned_booster_id),
      -- As 3 combinações novas -- cruzam account_type com no máximo UM outro
      -- filtro por vez (o dashboard só oferece um dropdown de rank e um de
      -- fila, nunca os dois junto com service_type).
      (o.assigned_booster_id, account_type),
      (o.assigned_booster_id, account_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (o.assigned_booster_id, account_type, o.queue_type::text)
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

  with champion_stats as (
    select
      o.assigned_booster_id as booster_id,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      m.champion,
      count(*) as games_played,
      count(*) filter (where m.result = 'win') as wins
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null
      and m.champion is not null
      and (p_booster_id is null or o.assigned_booster_id = p_booster_id)
    group by grouping sets (
      (o.assigned_booster_id, (case when o.boost_mode = 'duo' then 'duo' else 'solo' end), m.champion),
      (o.assigned_booster_id, m.champion)
    )
  )
  insert into public.booster_champion_stats (booster_id, account_type, champion, games_played, wins, calculated_at)
  select booster_id, coalesce(account_type, '__all__'), champion, games_played, wins, now()
  from champion_stats;
end;
$$;

revoke all on function public.refresh_booster_performance_segments(uuid) from public, anon, authenticated;
grant execute on function public.refresh_booster_performance_segments(uuid) to service_role;

-- Repopula tudo com o novo formato (idempotente -- a função já faz
-- delete+insert por booster).
select public.refresh_booster_performance_segments(null);
