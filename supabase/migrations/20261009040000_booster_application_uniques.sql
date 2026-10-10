-- M-52: CPF unico entre candidaturas ativas, bio limitada a 256 e erros claros (display_name_taken / cpf_taken / bio_too_long).
-- Mesma assinatura de onboard_booster: CREATE OR REPLACE (sem overload orfao).
create unique index if not exists booster_profiles_cpf_active_key
  on public.booster_profiles (cpf) where status <> 'removed' and cpf is not null;

alter table public.booster_profiles
  add constraint booster_profiles_bio_len_check check (bio is null or char_length(bio) <= 256) not valid;
alter table public.booster_profiles validate constraint booster_profiles_bio_len_check;

CREATE OR REPLACE FUNCTION public.onboard_booster(p_display_name text, p_bio text, p_peak_rank jsonb, p_opgg_link text DEFAULT NULL::text, p_hours_per_day_min integer DEFAULT NULL::integer, p_hours_per_day_max integer DEFAULT NULL::integer, p_full_name text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text, p_available_days text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role;
  v_email     text;
  v_bio       text := nullif(btrim(p_bio), '');
  v_opgg      text := nullif(btrim(p_opgg_link), '');
  v_full_name text := nullif(btrim(p_full_name), '');
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_tier      text := p_peak_rank->>'tier';
  v_booster_id uuid;
  v_is_new_application boolean;
begin
  if not public.check_own_write_rate_limit('onboard_booster', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  v_is_new_application := not exists(select 1 from public.booster_profiles where user_id = auth.uid() and status <> 'rejected');

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
  if char_length(v_bio) > 256 then
    return jsonb_build_object('success', false, 'error', 'bio_too_long');
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
  if not public.is_valid_cpf(v_cpf_digits) then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  begin
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
      status            = case when booster_profiles.status = 'rejected' then 'pending' else booster_profiles.status end,
      updated_at        = now()
    where booster_profiles.status in ('pending', 'rejected')
    returning id into v_booster_id;
  exception when unique_violation then
    if sqlerrm like '%display_name%' then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;
    return jsonb_build_object('success', false, 'error', 'cpf_taken');
  end;

  if v_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'application_not_editable');
  end if;

  if v_is_new_application then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'booster_pending_review', 'Novo booster pendente',
      btrim(p_display_name) || ' se candidatou como booster e está aguardando aprovação.',
      jsonb_build_object('booster_id', v_booster_id)
    from public.profiles where role = 'admin';

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-booster-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('booster_id', v_booster_id, 'display_name', btrim(p_display_name)),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;
