-- Os campos obrigatórios adicionados no frontend (BoosterApplicationForm,
-- BoosterProfessionalProfileForm, BoosterServiceForm) não tinham NENHUM
-- backing server-side -- onboard_booster aceitava bio/opgg_link/full_name/
-- cpf/peak_rank nulos sem reclamar, e BoosterProfessionalProfileForm/
-- BoosterServiceForm escreviam direto nas tabelas (update/insert client-side)
-- sem RPC nenhuma no meio. Um client malicioso (ou só uma chamada direta à
-- API REST do Supabase) contornava a validação inteira. Este é o fix.

-- ── onboard_booster: valida tudo que já aceitava + available_days ──────────
-- (available_days deixa de ser um update solto separado no client --
-- BoosterApplicationForm.tsx fazia uma segunda chamada, sem validação
-- nenhuma, só pra essa coluna.)
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
  if v_role is distinct from 'booster' then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
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

-- ── update_booster_professional_profile: nova RPC pra substituir o update
-- direto que BoosterProfessionalProfileForm.tsx fazia sem validação nenhuma
-- server-side. O trigger de cooldown de nome (migration 025/067) e o guard
-- de trust-columns (migration 001) continuam valendo do mesmo jeito, porque
-- ainda é um UPDATE de verdade na tabela por baixo -- só que agora com
-- validação de obrigatoriedade ANTES de chegar lá.
create or replace function public.update_booster_professional_profile(
  p_display_name      text,
  p_bio               text,
  p_lanes             text[],
  p_specialties       text[],
  p_peak_tier         text,
  p_opgg_link         text,
  p_available_days    text[],
  p_hours_per_day_min integer,
  p_hours_per_day_max integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_bio          text := nullif(btrim(p_bio), '');
  v_opgg         text := nullif(btrim(p_opgg_link), '');
begin
  if not exists (select 1 from public.booster_profiles where user_id = auth.uid()) then
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

grant execute on function public.update_booster_professional_profile(text, text, text[], text[], text, text, text[], integer, integer) to authenticated;

-- ── booster_services: campos "obrigatórios" no BoosterServiceForm não
-- tinham nenhum CHECK correspondente -- description/tempo aceitavam null,
-- lanes/specialties aceitavam null ou vazio, price aceitava 0. ─────────────
alter table public.booster_services
  alter column description set not null,
  alter column tempo set not null;

alter table public.booster_services
  drop constraint if exists booster_services_lanes_valid,
  drop constraint if exists booster_services_specialties_valid,
  drop constraint if exists booster_services_price_nonnegative;

alter table public.booster_services
  add constraint booster_services_title_nonempty check (btrim(title) <> ''),
  add constraint booster_services_description_nonempty check (btrim(description) <> ''),
  add constraint booster_services_tempo_nonempty check (btrim(tempo) <> ''),
  add constraint booster_services_price_positive check (price > 0),
  add constraint booster_services_lanes_valid check (
    lanes is not null and array_length(lanes, 1) between 1 and 2
    and lanes <@ array['top','jungle','mid','bot','support']
  ),
  add constraint booster_services_specialties_valid check (
    specialties is not null and array_length(specialties, 1) >= 1
    and specialties <@ array[
      'macro','micro','wave_control','invades','vision','trades',
      'teamfighting','laning_phase','objectives','itemization','matchups','mindset'
    ]
  );
