-- booster_performance_segments guarda várias granularidades pro MESMO
-- booster via grouping sets (refresh_booster_performance_segments):
-- (booster), (booster, service_type), (booster, service_type, rank_bucket),
-- (booster, account_type), (booster, account_type, rank_bucket),
-- (booster, account_type, queue_type) -- e cada uma tem account_type/
-- queue_type coalescidos pra '__all__' quando aquela dimensão não é a
-- quebra daquela linha. Isso significa que MAIS DE UMA linha pode ter
-- simultaneamente service_type='__all__' AND rank_bucket='__all__': a linha
-- global de verdade (account_type='__all__', queue_type='__all__') E a
-- quebra por account_type (ex.: account_type='solo', mas ainda
-- rank_bucket='__all__').
--
-- get_top_boosters e refresh_top3_boosters filtravam só por
-- (service_type, rank_bucket), nunca por (account_type, queue_type) --
-- então com 1 único booster que tem as duas linhas acima, ele aparecia
-- MAIS DE UMA VEZ no resultado de "top boosters" (parecia 3 boosters
-- diferentes ocupando top1/top2/top3, mas era o mesmo repetido). Fecha
-- pinando account_type='__all__' e queue_type='__all__' nas duas funções,
-- que é a única linha que representa de fato o agregado pedido.
create or replace function public.get_top_boosters(p_service_type text default '__all__'::text, p_rank_bucket text default '__all__'::text, p_limit integer default 3)
returns jsonb
language plpgsql stable security definer
set search_path to 'public' as $$
declare
  v_min_candidates constant integer := 3;
  v_rows jsonb;
  v_segment_used text;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
    select
      bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
      bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
      bps.total_matches, bps.wins, bps.losses,
      round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
      bps.average_kda, bps.review_count, bps.average_rating,
      bps.performance_score, bps.score_version, bps.updated_at
    from public.booster_performance_segments bps
    join public.booster_profiles bp on bp.user_id = bps.booster_id
    join public.profiles p on p.id = bp.user_id
    where bps.service_type = p_service_type and bps.rank_bucket = p_rank_bucket
      and bps.account_type = '__all__' and bps.queue_type = '__all__'
      and bp.status = 'approved'
    order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
    limit p_limit
  ) x;
  v_segment_used := 'exact';

  if p_rank_bucket <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = p_service_type and bps.rank_bucket = '__all__'
        and bps.account_type = '__all__' and bps.queue_type = '__all__'
        and bp.status = 'approved'
      order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
      limit p_limit
    ) x;
    v_segment_used := 'service_type_only';
  end if;

  if p_service_type <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = '__all__' and bps.rank_bucket = '__all__'
        and bps.account_type = '__all__' and bps.queue_type = '__all__'
        and bp.status = 'approved'
      order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
      limit p_limit
    ) x;
    v_segment_used := 'global';
  end if;

  return jsonb_build_object(
    'success', true,
    'segment_used', v_segment_used,
    'requested_service_type', p_service_type,
    'requested_rank_bucket', p_rank_bucket,
    'score_version', 'v1',
    'boosters', v_rows
  );
end;
$$;

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
      and  bps.total_matches > 0
    order  by bps.performance_score desc, bps.total_matches desc, bps.booster_id
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;
