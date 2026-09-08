-- 173_public_booster_profiles_opgg_link.sql
-- O perfil público do booster (BoosterPublicProfilePage) agora mostra o link
-- do op.gg dele, mesmo dado já preenchido no formulário de perfil
-- profissional (booster_profiles.opgg_link, ver ProfessionalProfileData) --
-- só que a view public_booster_profiles (usada por getPublicBooster) não
-- expunha essa coluna ainda. O link em si não é sensível (é uma página
-- pública do próprio op.gg), então adiciona ao final do SELECT sem mexer
-- nas colunas existentes.

create or replace view public.public_booster_profiles as
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
  bp.is_top3,
  bp.last_active_at,
  bp.updated_at,
  bp.lanes,
  bp.specialties,
  p.avatar_url,
  bp.opgg_link
from booster_profiles bp
join profiles p on p.id = bp.user_id
where bp.status = 'approved'::booster_status;
