-- Camada de domínio central para pontuação de boosters — usada pelo Top 3
-- (próxima migration) em vez de recalcular winrate/KDA/avaliação em cada
-- query de seleção ou, pior, no frontend.
--
-- Uma linha "específica" (service_type + rank_bucket reais) e, na mesma
-- tabela, linhas "rollup" com o sentinel '__all__' em uma ou ambas as
-- colunas — populadas de uma vez via GROUPING SETS. Isso dá o fallback
-- progressivo da seção 4.2 sem quadruplicar a lógica de agregação:
--   1. (service_type, rank_bucket) específicos
--   2. (service_type, '__all__')            — mesmo tipo, qualquer rank
--   3. ('__all__', '__all__')                — estatísticas gerais do booster
--
-- NULL não serve de sentinel aqui porque unique() trata NULL <> NULL — duas
-- linhas "globais" do mesmo booster não colidiriam e a tabela duplicaria.
--
-- ─── Fórmula (v1), documentada e centralizada ──────────────────────────────
--   performance_score = 45% adjusted_win_rate + 30% normalized_kda + 25% adjusted_rating
--   adjusted_win_rate: Wilson lower bound (95%) sobre wins/total_matches —
--     amostra pequena nunca supera um histórico consistente só por sorte.
--   normalized_kda: (kills+assists)/greatest(1,deaths), comprimido em [0,1]
--     via least(kda, 10) / 10 — uma partida de KDA 50 não domina o score.
--   adjusted_rating: média bayesiana puxada em direção a um prior neutro
--     (RATING_PRIOR/RATING_PRIOR_WEIGHT abaixo) — 5,0 em 1 avaliação não
--     supera 4,9 em centenas.
-- Ajustar pesos/prior exige mudar só esta função — nunca duplicar a conta
-- em outro lugar (frontend, controllers, etc).

create or replace function public.rank_bucket_of(p_tier text)
returns text
language sql immutable as $$
  select case
    when p_tier in ('iron', 'bronze', 'silver', 'gold') then 'gold_minus'
    when p_tier in ('platinum', 'emerald', 'diamond') then 'plat_diamond'
    when p_tier in ('master', 'grandmaster', 'challenger') then 'master_plus'
    else '__all__'
  end
$$;

create table public.booster_performance_segments (
  id uuid primary key default gen_random_uuid(),
  booster_id uuid not null references public.booster_profiles(user_id) on delete cascade,
  service_type text not null default '__all__',
  rank_bucket text not null default '__all__',
  total_matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  adjusted_win_rate numeric(6,5) not null default 0,
  average_kda numeric(6,3),
  normalized_kda numeric(6,5) not null default 0,
  review_count integer not null default 0,
  average_rating numeric(3,2),
  adjusted_rating numeric(6,5) not null default 0,
  performance_score numeric(6,2) not null default 0,
  score_version text not null default 'v1',
  last_match_at timestamptz,
  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booster_id, service_type, rank_bucket)
);

create index booster_performance_segments_lookup_idx
  on public.booster_performance_segments(service_type, rank_bucket, performance_score desc);
create index booster_performance_segments_booster_idx
  on public.booster_performance_segments(booster_id);

alter table public.booster_performance_segments enable row level security;

-- Score é insumo de seleção pública (Top 3) — leitura aberta, como as demais
-- tabelas de catálogo/perfil público. Escrita só pela função de refresh
-- (security definer, roda como o dono da função, não precisa de policy).
create policy "booster_performance_segments_read" on public.booster_performance_segments
  for select using (true);

revoke all on public.booster_performance_segments from public, anon, authenticated;
grant select on public.booster_performance_segments to anon, authenticated;

create or replace function public.refresh_booster_performance_segments(p_booster_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  -- Pesos da fórmula — únicos, documentados, versão 'v1'.
  w_winrate constant numeric := 0.45;
  w_kda     constant numeric := 0.30;
  w_rating  constant numeric := 0.25;
  -- Prior bayesiano neutro para avaliação com poucas amostras.
  rating_prior        constant numeric := 4.5;
  rating_prior_weight constant numeric := 10;
  -- z=1.96 → 95% de confiança no limite inferior de Wilson.
  wilson_z constant numeric := 1.96;
begin
  delete from public.booster_performance_segments
  where p_booster_id is null or booster_id = p_booster_id;

  with match_stats as (
    select
      o.assigned_booster_id as booster_id,
      o.service_type::text as service_type,
      public.rank_bucket_of(o.current_rank->>'tier') as rank_bucket,
      count(*) as total_matches,
      count(*) filter (where m.result = 'win') as wins,
      count(*) filter (where m.result = 'loss') as losses,
      avg((m.kills + m.assists)::numeric / greatest(1, m.deaths)) as average_kda,
      max(m.played_at) as last_match_at
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where o.assigned_booster_id is not null
      and (p_booster_id is null or o.assigned_booster_id = p_booster_id)
    group by grouping sets (
      (o.assigned_booster_id, o.service_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (o.assigned_booster_id, o.service_type),
      (o.assigned_booster_id)
    )
  ),
  match_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      total_matches, wins, losses, average_kda, last_match_at
    from match_stats
  ),
  review_stats as (
    select
      r.booster_id,
      o.service_type::text as service_type,
      public.rank_bucket_of(o.current_rank->>'tier') as rank_bucket,
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
      (r.booster_id)
    )
  ),
  review_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      review_count, average_rating
    from review_stats
  ),
  merged as (
    select
      coalesce(m.booster_id, r.booster_id) as booster_id,
      coalesce(m.service_type, r.service_type) as service_type,
      coalesce(m.rank_bucket, r.rank_bucket) as rank_bucket,
      coalesce(m.total_matches, 0) as total_matches,
      coalesce(m.wins, 0) as wins,
      coalesce(m.losses, 0) as losses,
      m.average_kda,
      m.last_match_at,
      coalesce(r.review_count, 0) as review_count,
      r.average_rating
    from match_stats_normalized m
    full outer join review_stats_normalized r
      on r.booster_id = m.booster_id
     and r.service_type = m.service_type
     and r.rank_bucket = m.rank_bucket
  ),
  scored as (
    select
      *,
      -- Wilson lower bound: (p + z²/2n − z·sqrt(p(1−p)/n + z²/4n²)) / (1 + z²/n)
      -- total_matches::numeric evita o operador `^` inteiro do Postgres, que
      -- resolve para double precision e quebra o round(numeric, int) depois.
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
    booster_id, service_type, rank_bucket,
    total_matches, wins, losses,
    adjusted_win_rate, average_kda, normalized_kda,
    review_count, average_rating, adjusted_rating,
    performance_score, score_version, last_match_at, calculated_at, updated_at
  )
  select
    booster_id, service_type, rank_bucket,
    total_matches, wins, losses,
    adjusted_win_rate_calc,
    average_kda,
    normalized_kda_calc,
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
end;
$$;

revoke all on function public.refresh_booster_performance_segments(uuid) from public, anon, authenticated;
grant execute on function public.refresh_booster_performance_segments(uuid) to service_role;

-- order_matches não tem trigger de refresh próprio: sync-order-matches pode
-- inserir várias partidas em uma única chamada, então o refresh roda uma vez
-- ao final do lote (chamado pela edge function) em vez de uma vez por linha
-- inserida — evita recomputar a tabela inteira N vezes na mesma sincronização.

-- Para avaliações o volume é sempre 1 por vez (um review por submissão), então
-- encadear no mesmo trigger que já existe (refresh_booster_rating) é seguro e
-- reviews — só encadeamos a atualização do score segmentado ali também).
create or replace function public.trg_fn_reviews_refresh_booster_rating()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if TG_OP = 'DELETE' then
    if old.booster_id is not null then
      perform public.refresh_booster_rating(old.booster_id);
      perform public.refresh_booster_performance_segments(old.booster_id);
    end if;
    return old;
  end if;

  if new.booster_id is not null then
    perform public.refresh_booster_rating(new.booster_id);
    perform public.refresh_booster_performance_segments(new.booster_id);
  end if;
  if TG_OP = 'UPDATE' and old.booster_id is not null and old.booster_id is distinct from new.booster_id then
    perform public.refresh_booster_rating(old.booster_id);
    perform public.refresh_booster_performance_segments(old.booster_id);
  end if;
  return new;
end;
$$;

-- Job de consistência: recalcula tudo periodicamente (cobre correções
-- administrativas de review/partida que não passem pelos triggers pontuais).
do $$
begin
  perform cron.unschedule('refresh-booster-performance-segments');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'refresh-booster-performance-segments',
    '17 * * * *',
    $cron$select public.refresh_booster_performance_segments(null);$cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — refresh_booster_performance_segments() exists but is not scheduled';
end $$;

-- Populamento inicial para os boosters que já têm partidas/avaliações.
select public.refresh_booster_performance_segments(null);
