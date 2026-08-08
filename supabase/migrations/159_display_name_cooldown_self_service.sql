-- update_my_display_name (RPC usada pelo painel "Minha Conta" ->
-- UserProfilePanel.tsx) até agora fazia um UPDATE direto na tabela, sem
-- passar pela mesma checagem estruturada que update_booster_professional_profile
-- já tem desde a migration 151 -- então a troca de nome dentro do cooldown
-- batia direto no trigger trg_fn_enforce_booster_display_name_cooldown, que
-- levanta uma exceção Postgres crua, e o front-end (bug separado, corrigido
-- junto) descartava a mensagem de qualquer forma e mostrava "Erro ao
-- salvar" genérico -- nunca "você só pode trocar em N dias".
--
-- Extrai o cálculo de dias restantes (antes duplicado dentro de
-- update_booster_professional_profile) pra uma função compartilhada, e cria
-- update_my_display_name espelhando o mesmo padrão de resposta estruturada
-- {success:false, error:'display_name_cooldown', days_remaining:N} -- o
-- valor é sempre calculado a partir de display_name_changed_at, então
-- regride dinamicamente a cada chamada conforme o tempo passa desde a
-- última troca.

create or replace function public.booster_display_name_cooldown_days_remaining(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select case
       when p.display_name_changed_at is null or p.display_name_changed_at <= now() - interval '30 days' then 0
       else ceil(extract(epoch from ((p.display_name_changed_at + interval '30 days') - now())) / 86400)::integer
     end
     from public.booster_profiles p
     where p.user_id = p_user_id
       and (auth.uid() = p_user_id or public.is_admin())),
    0
  );
$function$;

revoke all on function public.booster_display_name_cooldown_days_remaining(uuid) from public, anon;
grant execute on function public.booster_display_name_cooldown_days_remaining(uuid) to authenticated, service_role;

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

create or replace function public.update_my_display_name(p_display_name text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_days_remaining integer;
begin
  if not exists (select 1 from public.booster_profiles where user_id = auth.uid()) then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;

  v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
  if v_days_remaining > 0 then
    return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
  end if;

  update public.booster_profiles set display_name = v_display_name where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.update_my_display_name(text) from public, anon;
grant execute on function public.update_my_display_name(text) to authenticated;
