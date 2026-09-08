-- update_booster_professional_profile hoje deixa o UPDATE bater no trigger
-- trg_fn_enforce_booster_display_name_cooldown pra rejeitar troca de nome
-- dentro dos 30 dias -- o trigger levanta uma exceção Postgres crua (raise
-- exception), que sobe sem passar pelo padrão {success:false, error:<code>}
-- que TODA outra validação desta mesma função já usa (display_name_required,
-- invalid_lanes, etc., mapeadas em PROFESSIONAL_PROFILE_MESSAGES no
-- frontend). Isso deixa essa uma validação inconsistente com as demais e
-- dependente da mensagem crua do Postgres propagar igual até a UI.
--
-- Adiciona a mesma checagem ANTES do update, retornando
-- {success:false, error:'display_name_cooldown', days_remaining:N} no mesmo
-- formato das outras -- o frontend usa days_remaining pra montar "Troca
-- disponível em N dia(s)." O trigger continua existindo como última linha de
-- defesa (nunca confiar só na validação client-side/RPC).
create or replace function public.update_booster_professional_profile(
  p_display_name text, p_bio text, p_lanes text[], p_specialties text[],
  p_peak_tier text, p_opgg_link text, p_available_days text[],
  p_hours_per_day_min integer, p_hours_per_day_max integer
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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

  if v_display_name is distinct from v_current.display_name
     and not public.is_admin()
     and v_current.display_name_changed_at is not null
     and v_current.display_name_changed_at > now() - interval '30 days' then
    v_days_remaining := ceil(extract(epoch from ((v_current.display_name_changed_at + interval '30 days') - now())) / 86400);
    return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
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
$$;
