-- booster_profiles.rank_stats (KDA/winrate por faixa de elo, digitado à mão
-- pelo admin) foi substituído por booster_performance_segments, calculado
-- automaticamente a partir de partidas reais sincronizadas (migration 054 +
-- frontend desta sessão: BoosterPublicProfilePage, BoostersPage,
-- AdminBoosterDetailPage). Nada mais lê ou escreve nesta coluna -- a
-- ferramenta admin que a editava foi removida.

drop view public.public_booster_profiles;

create view public.public_booster_profiles
  with (security_barrier = true) as
select
  bp.id, bp.user_id, bp.display_name, bp.bio, bp.current_rank, bp.peak_rank,
  bp.games, bp.rating, bp.rating_count, bp.total_completed, bp.is_top3,
  bp.last_active_at, bp.updated_at, bp.lanes, bp.specialties,
  p.avatar_url
from public.booster_profiles bp
join public.profiles p on p.id = bp.user_id
where bp.status = 'approved'::public.booster_status;

grant select, insert, update, delete, truncate, references, trigger
  on public.public_booster_profiles to anon, authenticated;

create or replace function public.trg_fn_guard_booster_profile_trust_columns()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status          := old.status;
    new.total_completed := old.total_completed;
    new.total_earnings  := old.total_earnings;
    new.rating          := old.rating;
    new.rating_count    := old.rating_count;
    new.is_top3         := old.is_top3;
    new.verified_at     := old.verified_at;
    new.current_rank    := old.current_rank;
  end if;
  return new;
end;
$$;

alter table public.booster_profiles drop column rank_stats;
