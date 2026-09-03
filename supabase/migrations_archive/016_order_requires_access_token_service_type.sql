-- order_requires_access_token(p_service_id, p_boost_mode) compared
-- p_service_id — always a services.id uuid, see 015 — directly against
-- slugs like 'elo_boost'. That comparison can never be true, so every gate
-- built on it was silently broken:
--   * set_order_credentials always returned credentials_not_required_for_service
--     (customers could never actually save credentials for any real order)
--   * get_order_credentials / resolve_order_access_token failed the same way
--   * available_boost_orders' "not required OR credentials_set" filter was
--     always true, so orders that DO require credentials were visible in the
--     booster pool before any credentials existed
--   * accept_boost_order's missing_access_token guard never fired
--
-- Fix: gate on orders.service_type (added in 015) instead of service_id.

drop view public.available_boost_orders;
drop function public.order_requires_access_token(text, text);

create function public.order_requires_access_token(
  p_service_type public.service_type,
  p_boost_mode text
) returns boolean
language sql
immutable
set search_path = public as $$
  select
    (p_service_type = 'elo_boost' and coalesce(p_boost_mode, 'solo') = 'solo')
    or p_service_type in ('win_boost', 'placement_matches', 'md5')
$$;

create or replace function public.set_order_credentials(
  p_order_id uuid,
  p_login    text,
  p_password text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_key text;
  v_payload text;
  v_cipher bytea;
begin
  select id, customer_id, status, service_type, boost_mode
  into   v_order
  from   public.orders
  where  id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if nullif(trim(p_login), '') is null or length(trim(p_login)) > 160 then
    return jsonb_build_object('success', false, 'error', 'invalid_login');
  end if;

  if p_password is null or length(p_password) < 4 or length(p_password) > 256 then
    return jsonb_build_object('success', false, 'error', 'invalid_password');
  end if;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  v_payload := jsonb_build_object(
    'v', 1,
    'kind', 'riot_account_access',
    'order_id', p_order_id,
    'login', trim(p_login),
    'password', p_password,
    'issued_at', now()
  )::text;

  v_cipher := pgp_sym_encrypt(v_payload, v_key, 'compress-algo=1, cipher-algo=aes256');

  update public.orders
  set
    game_credentials = v_cipher::text,
    credentials_set  = true,
    updated_at       = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_cipher, 'base64')
  );
end;
$$;

create or replace function public.get_order_credentials(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  select id, assigned_booster_id, status, service_type, boost_mode, game_credentials, credentials_set
  into   v_order
  from   public.orders
  where  id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if v_order.status in ('completed', 'canceled', 'refunded', 'disputed') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  if not v_order.credentials_set or v_order.game_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_order.game_credentials::bytea, 'base64')
  );
end;
$$;

create or replace function public.resolve_order_access_token(p_access_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_order public.orders%rowtype;
begin
  if nullif(trim(p_access_token), '') is null or length(p_access_token) > 8192 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  begin
    v_cipher := decode(p_access_token, 'base64');
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_payload := pgp_sym_decrypt(v_cipher, v_key)::jsonb;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select * into v_order
  from public.orders
  where id = (v_payload->>'order_id')::uuid
    and credentials_set = true
    and game_credentials::bytea = v_cipher
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if v_order.status in ('completed', 'canceled', 'refunded', 'disputed') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'login', v_payload->>'login',
    'password', v_payload->>'password'
  );
end;
$$;

revoke all on function public.resolve_order_access_token(text) from public, anon, authenticated;
grant execute on function public.resolve_order_access_token(text) to service_role;

create view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  );

grant select on public.available_boost_orders to authenticated;

create or replace function public.accept_boost_order(
  p_order_id uuid,
  p_booster_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if public.order_requires_access_token(v_order.service_type, v_order.boost_mode)
     and not v_order.credentials_set then
    return jsonb_build_object('success', false, 'error', 'missing_access_token');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.exclusive_until is not null
     and v_order.exclusive_until > now()
     and v_order.preferred_booster_id <> p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null
    and v_order.exclusive_until > now();

  if v_is_exclusive then
    if public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'assigned', assigned_booster_id = p_booster_user_id, used_exclusive_slot = true, updated_at = now()
    where id = p_order_id;

    return jsonb_build_object('success', true, 'details', jsonb_build_object('used_exclusive_slot', true));
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'assigned', assigned_booster_id = p_booster_user_id, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;
