-- Seleção sistematizada dos 3 melhores boosters, substituindo a antiga
-- "Top 5 Boosters" (que só existia como podium público baseado no flag
-- is_top5). is_top5 continua existindo e sendo usado exatamente como antes
-- (booster_active_slot_counts(), bônus de slot de pedido concorrente) — é
-- uma feature operacional separada, não a vitrine de recomendação para
-- clientes, e não é tocada aqui.
--
-- Fallback progressivo sobre booster_performance_segments (linhas '__all__'
-- já cobrem os 3 níveis via rollup da migration 054):
--   1. service_type + rank_bucket específicos
--   2. service_type específico, qualquer rank
--   3. estatísticas gerais do booster (ambos '__all__')
-- Cai pro próximo nível quando o nível atual não tem boosters qualificados
-- suficientes — nunca retorna lista vazia só por falta de dado no segmento
-- exato quando existe alternativa mais ampla.
--
-- Desempate determinístico: maior performance_score, maior total_matches
-- (confiabilidade estatística), maior review_count, atualização mais
-- recente, booster_id como último recurso — mesma entrada sempre produz a
-- mesma ordem.
create or replace function public.get_top_boosters(
  p_service_type text default '__all__',
  p_rank_bucket text default '__all__',
  p_limit integer default 3
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_min_candidates constant integer := 3;
  v_rows jsonb;
  v_segment_used text;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
    select
      bps.booster_id, bp.display_name, p.avatar_url, bp.current_rank,
      bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
      bps.total_matches, bps.wins, bps.losses,
      round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
      bps.average_kda, bps.review_count, bps.average_rating,
      bps.performance_score, bps.score_version, bps.updated_at
    from public.booster_performance_segments bps
    join public.booster_profiles bp on bp.user_id = bps.booster_id
    join public.profiles p on p.id = bp.user_id
    where bps.service_type = p_service_type and bps.rank_bucket = p_rank_bucket
      and bp.status = 'approved'
    order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
    limit p_limit
  ) x;
  v_segment_used := 'exact';

  if p_rank_bucket <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = p_service_type and bps.rank_bucket = '__all__'
        and bp.status = 'approved'
      order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
      limit p_limit
    ) x;
    v_segment_used := 'service_type_only';
  end if;

  if p_service_type <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.adjusted_win_rate * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = '__all__' and bps.rank_bucket = '__all__'
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

revoke all on function public.get_top_boosters(text, text, integer) from public;
grant execute on function public.get_top_boosters(text, text, integer) to anon, authenticated;
