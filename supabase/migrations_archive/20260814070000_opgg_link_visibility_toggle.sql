-- Booster quer poder esconder o link do OP.GG do perfil público sem deixar
-- de preenchê-lo (o campo continua obrigatório pra salvar o perfil
-- profissional). Adiciona opgg_link_visible (default true = comportamento
-- atual preservado) e faz public_booster_profiles devolver null quando
-- desmarcado -- BoosterPublicProfilePage já só renderiza o link se ele vier
-- preenchido, então não precisa mexer lá.

alter table public.booster_profiles
  add column opgg_link_visible boolean not null default true;

drop function if exists public.update_booster_professional_profile(
  text, text, text, text, text[], integer, integer
);

create or replace function public.update_booster_professional_profile(
  p_display_name text,
  p_bio text,
  p_peak_tier text,
  p_opgg_link text,
  p_opgg_link_visible boolean,
  p_available_days text[],
  p_hours_per_day_min integer,
  p_hours_per_day_max integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_bio          text := nullif(btrim(p_bio), '');
  v_opgg         text := nullif(btrim(p_opgg_link), '');
  v_current      record;
  v_days_remaining integer;
begin
  select display_name, display_name_changed_at into v_current
  from public.booster_profiles where user_id = auth.uid();

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;

  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if p_peak_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  if v_display_name is distinct from v_current.display_name then
    if exists (
      select 1 from public.booster_profiles
      where lower(display_name) = lower(v_display_name) and user_id <> auth.uid()
    ) then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;

    v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
    if v_days_remaining > 0 then
      return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
    end if;
  end if;

  update public.booster_profiles
  set display_name       = v_display_name,
      bio                = v_bio,
      peak_rank          = jsonb_build_object('tier', p_peak_tier, 'division', null),
      opgg_link          = v_opgg,
      opgg_link_visible  = coalesce(p_opgg_link_visible, true),
      available_days     = p_available_days,
      hours_per_day_min  = p_hours_per_day_min,
      hours_per_day_max  = p_hours_per_day_max,
      updated_at         = now()
  where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;

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
  case when bp.opgg_link_visible then bp.opgg_link else null end as opgg_link
from booster_profiles bp
join profiles p on p.id = bp.user_id
where bp.status = 'approved'::booster_status;

-- Backfill do "_0" residual do bug de discriminator do Discord (ver
-- 20260814060000_fix_discord_username_discriminator.sql) -- essas 2 linhas
-- em booster_profiles.display_name não foram cobertas por aquele backfill
-- porque display_name é gravado à parte na candidatura, não copiado de
-- profiles.username depois. Confirmado que profiles.username já foi
-- corrigido pro valor limpo; só reaplica o mesmo valor aqui, sem colisão.
update public.booster_profiles bp
set display_name = p.username
from public.profiles p
where bp.user_id = p.id
  and bp.display_name = p.username || '_0'
  and not exists (
    select 1 from public.booster_profiles bp2
    where lower(bp2.display_name) = lower(p.username) and bp2.user_id <> bp.user_id
  );
