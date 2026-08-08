-- A URL pública do booster (/boosters/:id) vai passar a usar display_name
-- em vez de booster_profiles.id (migration acompanhada da mudança no
-- front-end) -- pra isso ser seguro, display_name precisa ser único
-- (hoje só é único de fato por acaso, sem constraint). Índice único
-- case-insensitive: "Foo" e "foo" colidiriam na mesma URL /boosters/foo.
--
-- Também fecha uma lacuna que sobrou: nem update_my_display_name (migration
-- 159) nem update_booster_professional_profile checavam se o novo nome já
-- pertencia a outro booster antes do UPDATE -- sem a constraint isso só
-- daria um erro de índice único cru; com ela, a RPC agora checa antes e
-- devolve {success:false, error:'display_name_taken'} no mesmo padrão
-- estruturado das outras validações (mesma ideia de update_my_username /
-- 'username_taken'). update_my_display_name também ganha o mesmo guard
-- "só verifica cooldown/unicidade se o nome de fato mudou" que
-- update_booster_professional_profile já tinha -- sem isso, reenviar o
-- mesmo nome durante o cooldown era bloqueado incorretamente.
create unique index if not exists booster_profiles_display_name_lower_key
  on public.booster_profiles (lower(display_name));

create or replace function public.update_my_display_name(p_display_name text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_current_name text;
  v_days_remaining integer;
begin
  select display_name into v_current_name from public.booster_profiles where user_id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;

  if v_display_name is distinct from v_current_name then
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

  update public.booster_profiles set display_name = v_display_name where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.update_booster_professional_profile(
  p_display_name text, p_bio text, p_lanes text[], p_specialties text[],
  p_peak_tier text, p_opgg_link text, p_available_days text[],
  p_hours_per_day_min integer, p_hours_per_day_max integer
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
  if p_lanes is null or array_length(p_lanes, 1) is null or array_length(p_lanes, 1) > 2
     or not (p_lanes <@ array['top','jungle','mid','bot','support']) then
    return jsonb_build_object('success', false, 'error', 'invalid_lanes');
  end if;
  if p_specialties is null or array_length(p_specialties, 1) is null
     or not (p_specialties <@ array[
       'macro','micro','wave_control','invades','vision','trades',
       'teamfighting','laning_phase','objectives','itemization','matchups','mindset'
     ]) then
    return jsonb_build_object('success', false, 'error', 'invalid_specialties');
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
      lanes             = p_lanes,
      specialties       = p_specialties,
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
