-- Achado BAIXO da auditoria de segurança: o sistema de credenciais de conta
-- do CLIENTE (036: set_order_credentials/get_order_credentials/
-- resolve_order_access_token) nunca grava em audit_logs, ao contrário do
-- sistema de duo accounts (056), que audita toda emissão/leitura de
-- credencial (duo_account.credentials_viewed, duo_account.access_token_issued
-- etc.). Ambos os sistemas são igualmente bem escopados por autorização --
-- isto só adiciona o mesmo rastro de auditoria que já existe do lado das
-- duo accounts, sem mudar nenhuma regra de acesso.
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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'customer'::public.user_role, 'order_credentials.set', 'order', v_order.id::text);

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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_requester, public.current_user_role(), 'order_credentials.viewed', 'order', p_order_id::text);

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_order.game_credentials::bytea, 'base64'),
    'expires_at', v_order.credential_expires_at
  );
end;
$$;

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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (p_booster_user_id, 'booster'::public.user_role, 'order_credentials.resolved', 'order', v_order.id::text);

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

revoke all on function public.set_order_credentials(uuid, text, text) from public, anon;
revoke all on function public.get_order_credentials(uuid) from public, anon;
grant execute on function public.set_order_credentials(uuid, text, text) to authenticated;
grant execute on function public.get_order_credentials(uuid) to authenticated;
