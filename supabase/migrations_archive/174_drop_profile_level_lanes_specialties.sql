-- 174_drop_profile_level_lanes_specialties.sql
-- "Lanes Masterizadas" e "Especialidades" saem do formulário de Perfil
-- Profissional (BoosterProfessionalProfileForm) -- esses dados já existem
-- por serviço (booster_services.lanes/specialties, ver BoosterServiceForm),
-- então o campo no nível do booster inteiro virou duplicata sem uso real
-- (BoosterPublicProfilePage já não exibe mais lanes/specialties do booster
-- desde a última reforma do perfil público, só por serviço). Recria a
-- função sem p_lanes/p_specialties -- como isso muda a assinatura (menos
-- parâmetros), precisa dropar a versão antiga antes.

drop function if exists public.update_booster_professional_profile(
  text, text, text[], text[], text, text, text[], integer, integer
);

create or replace function public.update_booster_professional_profile(
  p_display_name text,
  p_bio text,
  p_peak_tier text,
  p_opgg_link text,
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
  set display_name      = v_display_name,
      bio               = v_bio,
      peak_rank         = jsonb_build_object('tier', p_peak_tier, 'division', null),
      opgg_link         = v_opgg,
      available_days    = p_available_days,
      hours_per_day_min = p_hours_per_day_min,
      hours_per_day_max = p_hours_per_day_max,
      updated_at        = now()
  where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;
