-- Bug real: "enviei o formulário de booster e a tela de 'aguarde aprovação'
-- nunca apareceu". Migration 076 (booster_required_field_backend_validation)
-- reescreveu onboard_booster() e trocou o gate de role de
-- `v_role not in ('customer','booster')` (013, correto) para
-- `v_role is distinct from 'booster'` -- exigindo que o usuário JÁ seja
-- booster pra poder... se candidatar a booster. Como approve_booster() (013)
-- é o ÚNICO lugar que promove role pra 'booster' (só após aprovação do
-- admin), todo cliente que tentava se candidatar pela primeira vez (role
-- ainda 'customer') recebia 'not_a_booster' da RPC -- a inserção em
-- booster_profiles nunca acontecia, e por isso a tela de pendente
-- (BoosterApplyPage → PendingScreen) nunca tinha o que mostrar.
create or replace function public.onboard_booster(
  p_display_name      text,
  p_bio               text,
  p_peak_rank         jsonb,
  p_opgg_link         text    default null,
  p_hours_per_day_min integer default null,
  p_hours_per_day_max integer default null,
  p_full_name         text    default null,
  p_cpf               text    default null,
  p_available_days    text[]  default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role      public.user_role;
  v_email     text;
  v_bio       text := nullif(btrim(p_bio), '');
  v_opgg      text := nullif(btrim(p_opgg_link), '');
  v_full_name text := nullif(btrim(p_full_name), '');
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_tier      text := p_peak_rank->>'tier';
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  if nullif(btrim(p_display_name), '') is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if v_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;
  if v_full_name is null then
    return jsonb_build_object('success', false, 'error', 'full_name_required');
  end if;
  if char_length(v_cpf_digits) <> 11 then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.booster_profiles(
    user_id, display_name, bio, status,
    peak_rank, opgg_link, hours_per_day_min, hours_per_day_max,
    full_name, email, cpf, available_days
  )
  values (
    auth.uid(), btrim(p_display_name), v_bio, 'pending',
    p_peak_rank, v_opgg, p_hours_per_day_min, p_hours_per_day_max,
    v_full_name, v_email, v_cpf_digits, p_available_days
  )
  on conflict (user_id) do update set
    display_name      = excluded.display_name,
    bio               = excluded.bio,
    peak_rank         = excluded.peak_rank,
    opgg_link         = excluded.opgg_link,
    hours_per_day_min = excluded.hours_per_day_min,
    hours_per_day_max = excluded.hours_per_day_max,
    full_name         = excluded.full_name,
    email             = excluded.email,
    cpf               = excluded.cpf,
    available_days    = excluded.available_days,
    updated_at        = now();

  return jsonb_build_object('success', true);
end;
$$;
