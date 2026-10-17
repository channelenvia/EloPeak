-- CPF criptografado em repouso (pgcrypto AES-256, chave `credential_key` do Vault) + hash HMAC pro indice unico.
-- Compat: quem ainda grava `booster_profiles.cpf` (RPCs, seeds de teste) continua funcionando -- o trigger
-- cifra e zera a coluna em texto puro. Leitura do CPF so via get_my_cpf() / admin_get_booster_cpf() /
-- admin_get_payout_cpf() (as duas de admin deixam rastro em audit_logs).

-- Garante a chave (prod ja tem; ambiente novo/teste ganha uma aleatoria).
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'credential_key' and char_length(decrypted_secret) >= 32) then
    delete from vault.secrets where name = 'credential_key';
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'credential_key');
  end if;
end $$;

create or replace function public._cpf_key() returns text
  language plpgsql security definer set search_path to 'public'
as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then raise exception 'server_key_not_configured'; end if;
  return v_key;
end $$;

create or replace function public._cpf_encrypt(p_cpf text) returns bytea
  language sql security definer set search_path to 'public', 'extensions'
as $$ select pgp_sym_encrypt(p_cpf, public._cpf_key(), 'cipher-algo=aes256') $$;

create or replace function public._cpf_decrypt(p_enc bytea) returns text
  language sql security definer set search_path to 'public', 'extensions'
as $$ select pgp_sym_decrypt(p_enc, public._cpf_key()) $$;

create or replace function public._cpf_hash(p_cpf text) returns text
  language sql security definer set search_path to 'public', 'extensions'
as $$ select encode(hmac(p_cpf, public._cpf_key(), 'sha256'), 'hex') $$;

create or replace function public._cpf_mask(p_cpf text) returns text
  language sql immutable set search_path to 'public'
as $$ select case when p_cpf ~ '^[0-9]{11}$' then substr(p_cpf, 1, 3) || '.***.***-' || substr(p_cpf, 10, 2) end $$;

revoke all on function public._cpf_key(), public._cpf_encrypt(text), public._cpf_decrypt(bytea),
  public._cpf_hash(text), public._cpf_mask(text) from public;
grant execute on function public._cpf_key(), public._cpf_encrypt(text), public._cpf_decrypt(bytea),
  public._cpf_hash(text), public._cpf_mask(text) to service_role;

alter table public.booster_profiles add column if not exists cpf_enc bytea, add column if not exists cpf_hash text;
alter table public.payout_requests add column if not exists booster_cpf_enc bytea;

create or replace function public.trg_fn_booster_profiles_encrypt_cpf() returns trigger
  language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.cpf is not null then
    new.cpf_enc := public._cpf_encrypt(new.cpf);
    new.cpf_hash := public._cpf_hash(new.cpf);
    new.cpf := null;
  end if;
  return new;
end $$;
revoke all on function public.trg_fn_booster_profiles_encrypt_cpf() from public;

create trigger trg_booster_profiles_encrypt_cpf
  before insert or update on public.booster_profiles
  for each row execute function public.trg_fn_booster_profiles_encrypt_cpf();

-- Backfill (dados existentes em texto puro)
update public.booster_profiles set cpf = cpf where cpf is not null;
update public.payout_requests
   set booster_cpf_enc = public._cpf_encrypt(booster_cpf_snapshot),
       booster_cpf_snapshot = public._cpf_mask(booster_cpf_snapshot)
 where booster_cpf_enc is null and booster_cpf_snapshot ~ '^[0-9]{11}$';

drop index if exists public.booster_profiles_cpf_active_key;
create unique index booster_profiles_cpf_active_key on public.booster_profiles (cpf_hash)
  where status <> 'removed'::public.booster_status and cpf_hash is not null;

-- Guard de colunas privilegiadas: agora tambem cobre o CPF cifrado.
CREATE OR REPLACE FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if new.is_top3 is distinct from old.is_top3
     or new.total_earnings is distinct from old.total_earnings
     or new.rating is distinct from old.rating
     or new.rating_count is distinct from old.rating_count
     or new.suspended_until is distinct from old.suspended_until
     or new.verified_at is distinct from old.verified_at
     or new.total_completed is distinct from old.total_completed
     or new.cpf is distinct from old.cpf
     or new.cpf_enc is distinct from old.cpf_enc
     or new.cpf_hash is distinct from old.cpf_hash
     or new.full_name is distinct from old.full_name
     or new.email is distinct from old.email
     or new.peak_rank is distinct from old.peak_rank
  then
    raise exception 'only admins can change privileged booster_profiles columns' using errcode = '42501';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() OWNER TO "postgres";

-- onboard_booster: ON CONFLICT precisa copiar cpf_enc/cpf_hash (EXCLUDED ja vem pos-trigger, com cpf = null).
CREATE OR REPLACE FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text" DEFAULT NULL::"text", "p_hours_per_day_min" integer DEFAULT NULL::integer, "p_hours_per_day_max" integer DEFAULT NULL::integer, "p_full_name" "text" DEFAULT NULL::"text", "p_cpf" "text" DEFAULT NULL::"text", "p_available_days" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  if char_length(btrim(p_display_name)) > 32 or btrim(p_display_name) !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$' then
    return jsonb_build_object('success', false, 'error', 'display_name_invalid');
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
      cpf_enc           = excluded.cpf_enc,
      cpf_hash          = excluded.cpf_hash,
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
$_$;


ALTER FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text", "p_hours_per_day_min" integer, "p_hours_per_day_max" integer, "p_full_name" "text", "p_cpf" "text", "p_available_days" "text"[]) OWNER TO "postgres";

-- request_payout: snapshot cifrado (copia o cipher) + versao mascarada pra listagem.
CREATE OR REPLACE FUNCTION "public"."request_payout"("p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
  v_min_amount constant numeric := 50.00;
begin
  if not public.check_own_write_rate_limit('request_payout', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if p_amount < v_min_amount then
    return jsonb_build_object('success', false, 'error', 'below_minimum_amount', 'minimum', v_min_amount);
  end if;

  if not public.is_payout_window_day() then
    return jsonb_build_object('success', false, 'error', 'withdrawal_window_closed');
  end if;

  -- Serializa solicitações concorrentes do mesmo booster (evita duas
  -- requisições simultâneas passarem ambas no cheque de saldo antes de
  -- qualquer uma commitar).
  select * into v_booster from public.booster_profiles where user_id = auth.uid() for update;
  if v_booster is null or v_booster.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;

  v_available := public.booster_available_balance(auth.uid());
  if v_available < 0 then
    return jsonb_build_object('success', false, 'error', 'negative_balance', 'available', v_available);
  end if;
  if p_amount > v_available then
    return jsonb_build_object('success', false, 'error', 'insufficient_balance', 'available', v_available);
  end if;

  insert into public.payout_requests(
    booster_id, amount, booster_cpf_snapshot, booster_cpf_enc, booster_legal_name_snapshot
  ) values (
    auth.uid(), p_amount, public._cpf_mask(public._cpf_decrypt(v_booster.cpf_enc)), v_booster.cpf_enc, v_booster.full_name
  )
  returning id into v_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    auth.uid(), v_request_id, 'payout_reservation', -p_amount,
    'Reserva para solicitação de saque ' || v_request_id::text, auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.created', 'payout_request', v_request_id::text,
          jsonb_build_object('amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'payout_request_created', 'Nova solicitação de saque',
         'Um booster solicitou saque de R$ ' || p_amount::text,
         jsonb_build_object('payout_request_id', v_request_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true, 'request_id', v_request_id);
end;
$_$;


ALTER FUNCTION "public"."request_payout"("p_amount" numeric) OWNER TO "postgres";

create or replace function public.update_my_cpf(p_cpf text) returns jsonb
  language plpgsql security definer set search_path to 'public', 'extensions'
as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_old text;
begin
  if not public.check_own_write_rate_limit('update_my_cpf', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_valid_cpf(v_cpf) then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  select cpf_hash into v_old from public.booster_profiles where user_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  update public.booster_profiles set cpf = v_cpf, updated_at = now() where user_id = auth.uid();
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'booster_profile.cpf_changed', 'booster_profile', auth.uid()::text,
          jsonb_build_object('changed', v_old is distinct from public._cpf_hash(v_cpf)));
  return jsonb_build_object('success', true);
end $$;

create or replace function public.get_my_cpf() returns text
  language sql security definer set search_path to 'public'
as $$ select public._cpf_decrypt(cpf_enc) from public.booster_profiles where user_id = auth.uid() and cpf_enc is not null $$;

create or replace function public.admin_get_booster_cpf(p_user_id uuid) returns text
  language plpgsql security definer set search_path to 'public'
as $$
declare v_enc bytea;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select cpf_enc into v_enc from public.booster_profiles where user_id = p_user_id;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'booster_profile.cpf_viewed', 'booster_profile', p_user_id::text);
  return case when v_enc is null then null else public._cpf_decrypt(v_enc) end;
end $$;

create or replace function public.admin_get_payout_cpf(p_request_id uuid) returns text
  language plpgsql security definer set search_path to 'public'
as $$
declare v_enc bytea;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select booster_cpf_enc into v_enc from public.payout_requests where id = p_request_id;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'payout_request.cpf_viewed', 'payout_request', p_request_id::text);
  return case when v_enc is null then null else public._cpf_decrypt(v_enc) end;
end $$;

revoke all on function public.update_my_cpf(text), public.get_my_cpf(),
  public.admin_get_booster_cpf(uuid), public.admin_get_payout_cpf(uuid) from public;
grant execute on function public.update_my_cpf(text), public.get_my_cpf(),
  public.admin_get_booster_cpf(uuid), public.admin_get_payout_cpf(uuid) to authenticated, service_role;
