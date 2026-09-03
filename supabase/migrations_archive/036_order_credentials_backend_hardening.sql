-- Keep account credentials as an encrypted, short-lived access token and make
-- every plaintext operation a backend-only, authorization-checked operation.

alter table public.orders
  add column if not exists credential_expires_at timestamptz;

-- Tokens issued by the older contract had no enforceable expiration. Requiring
-- regeneration is safer than silently extending them.
update public.orders
set game_credentials = null,
    credentials_set = false,
    credential_expires_at = null,
    updated_at = now()
where credentials_set = true or game_credentials is not null;

alter table public.orders
  drop constraint if exists orders_credentials_consistency_check;

alter table public.orders
  add constraint orders_credentials_consistency_check check (
    (
      credentials_set = true
      and game_credentials is not null
      and credential_expires_at is not null
    )
    or (
      credentials_set = false
      and game_credentials is null
      and credential_expires_at is null
    )
  );

create or replace function public.set_order_credentials(
  p_order_id uuid,
  p_login text,
  p_password text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_key text;
  v_payload text;
  v_cipher bytea;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, customer_id, status, payment_status, service_type, boost_mode
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if nullif(btrim(p_login), '') is null or char_length(btrim(p_login)) > 160 then
    return jsonb_build_object('success', false, 'error', 'invalid_login');
  end if;

  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 256 then
    return jsonb_build_object('success', false, 'error', 'invalid_password');
  end if;

  select decrypted_secret
  into v_key
  from vault.decrypted_secrets
  where name = 'credential_key'
  limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  v_payload := jsonb_build_object(
    'v', 2,
    'kind', 'riot_account_access',
    'order_id', v_order.id,
    'customer_id', v_order.customer_id,
    'login', btrim(p_login),
    'password', p_password,
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text;

  v_cipher := pgp_sym_encrypt(
    v_payload,
    v_key,
    'compress-algo=1, cipher-algo=aes256'
  );

  update public.orders
  set game_credentials = v_cipher::text,
      credentials_set = true,
      credential_expires_at = v_expires_at,
      updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_cipher, 'base64'),
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.get_order_credentials(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_requester uuid := auth.uid();
begin
  if v_requester is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, game_credentials, credentials_set,
         credential_expires_at
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_requester is distinct from v_order.customer_id
     and v_requester is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if not v_order.credentials_set or v_order.game_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  if v_order.credential_expires_at is null or v_order.credential_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired');
  end if;

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_order.game_credentials::bytea, 'base64'),
    'expires_at', v_order.credential_expires_at
  );
end;
$$;

drop function if exists public.resolve_order_access_token(text);

create or replace function public.resolve_order_access_token(
  p_access_token text,
  p_booster_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_order_id uuid;
  v_order record;
begin
  if p_booster_user_id is null
     or nullif(btrim(p_access_token), '') is null
     or char_length(p_access_token) > 8192 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  begin
    v_cipher := decode(p_access_token, 'base64');
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select decrypted_secret
  into v_key
  from vault.decrypted_secrets
  where name = 'credential_key'
  limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_payload := pgp_sym_decrypt(v_cipher, v_key)::jsonb;
    if v_payload->>'v' <> '2'
       or v_payload->>'kind' <> 'riot_account_access'
       or nullif(v_payload->>'login', '') is null
       or nullif(v_payload->>'password', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_order_id := (v_payload->>'order_id')::uuid;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, game_credentials, credentials_set,
         credential_expires_at
  into v_order
  from public.orders
  where id = v_order_id
    and assigned_booster_id = p_booster_user_id
    and credentials_set = true
    and game_credentials::bytea = v_cipher
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;

  if not exists (
    select 1
    from public.booster_profiles bp
    where bp.user_id = p_booster_user_id
      and bp.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'booster_not_authorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if v_order.credential_expires_at is null
     or v_order.credential_expires_at <= now()
     or (v_payload->>'expires_at')::timestamptz <= now()
     or (v_payload->>'customer_id')::uuid is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'login', v_payload->>'login',
    'password', v_payload->>'password'
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'invalid_token');
end;
$$;

revoke all on function public.resolve_order_access_token(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_order_access_token(text, uuid) to service_role;

-- Terminal or unpaid orders must not retain a usable encrypted payload.
create or replace function public.clear_terminal_order_credentials()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status in ('completed', 'canceled', 'refunded', 'disputed')
     or new.payment_status is distinct from 'paid'::public.payment_status then
    new.game_credentials := null;
    new.credentials_set := false;
    new.credential_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_terminal_order_credentials_trigger on public.orders;
create trigger clear_terminal_order_credentials_trigger
before update of status, payment_status on public.orders
for each row execute function public.clear_terminal_order_credentials();

-- RLS is row-level. Column grants are required to keep the encrypted payload
-- out of PostgREST responses, browser devtools and accidental select('*') calls.
revoke select on public.orders from anon, authenticated;
grant select (
  id, customer_id, service_id, service_type, game_id, booster_service_id,
  assigned_booster_id, status, queue_type, boost_mode, server, current_rank,
  target_rank, wins_purchased, sessions_purchased, win_package, extras,
  base_price, extras_price, total_price, estimated_hours, customer_notes,
  booster_notes, payment_status, credentials_set, credential_expires_at,
  wins_played, losses_played, completed_at, created_at, updated_at,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  idempotency_key, mp_payment_id, riot_id, discord_voice_channel_id,
  preferred_booster_id, exclusive_until, used_exclusive_slot,
  md5_matches_remaining, chat_locked, chat_locked_at, chat_locked_by
) on public.orders to authenticated;

revoke all on function public.set_order_credentials(uuid, text, text) from public, anon;
revoke all on function public.get_order_credentials(uuid) from public, anon;
grant execute on function public.set_order_credentials(uuid, text, text) to authenticated;
grant execute on function public.get_order_credentials(uuid) to authenticated;
