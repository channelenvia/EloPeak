-- Expõe o avatar público do usuário na view segura de boosters.
-- O frontend não deve consultar `profiles` diretamente para montar cards públicos.

update public.profiles
set avatar_url = regexp_replace(
  avatar_url,
  '^https://ddragon\.leagueoflegends\.com/cdn/[^/]+/img/profileicon/([0-9]+)\.png$',
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/\1.jpg'
)
where avatar_url ~ '^https://ddragon\.leagueoflegends\.com/cdn/[^/]+/img/profileicon/[0-9]+\.png$';

create or replace view public.public_booster_profiles
  with (security_barrier = true) as
select
  bp.id,
  bp.user_id,
  bp.display_name,
  bp.bio,
  bp.current_rank,
  bp.peak_rank,
  bp.games,
  bp.rating,
  bp.rating_count,
  bp.total_completed,
  bp.is_available,
  bp.is_top5,
  bp.rank_stats,
  bp.last_active_at,
  bp.updated_at,
  bp.lanes,
  bp.specialties,
  p.avatar_url
from public.booster_profiles bp
join public.profiles p on p.id = bp.user_id
where bp.status = 'approved';

grant select on public.public_booster_profiles to anon, authenticated;
