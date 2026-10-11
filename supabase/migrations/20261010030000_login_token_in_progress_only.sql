-- Token de login (credencial do jogo) so pode ser emitido e resolvido para pedido com status 'in_progress'.
-- Mesmas assinaturas das funcoes do baseline (CREATE OR REPLACE sem overload orfao). Corpo copiado do baseline
-- com apenas a checagem de status alterada. Tambem invalida token emitido quando o status/booster do pedido muda,
-- para um token emitido em andamento nao voltar a valer se o pedido pausar e retomar dentro da janela de 5 min.
-- Nao altera orders.status, entao nao insere em order_status_history. get_*_access_token mantem o rate limit existente.

CREATE OR REPLACE FUNCTION public.get_order_credentials(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_order record;
  v_requester uuid := auth.uid();
  v_key text;
  v_stored_payload jsonb;
  v_token_id uuid;
  v_token_expires_at timestamptz;
  v_new_payload text;
  v_new_cipher bytea;
begin
  if v_requester is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('get_order_credentials', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, game_credentials, credentials_set,
         credential_expires_at
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_requester is distinct from v_order.customer_id
     and v_requester is distinct from v_order.assigned_booster_id
     and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Token de login so existe para pedido em andamento (nenhum outro status).
  if v_order.status is distinct from 'in_progress'::public.order_status then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;
  if v_order.payment_status is distinct from 'paid'::public.payment_status then
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

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_stored_payload := pgp_sym_decrypt(v_order.game_credentials::bytea, v_key)::jsonb;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end;

  v_token_id := gen_random_uuid();
  v_token_expires_at := now() + interval '5 minutes';

  v_new_payload := jsonb_build_object(
    'v', 3,
    'kind', 'riot_account_access',
    'token_id', v_token_id,
    'order_id', v_order.id,
    'customer_id', v_order.customer_id,
    'login', v_stored_payload->>'login',
    'password', v_stored_payload->>'password',
    'issued_at', now(),
    'expires_at', v_token_expires_at
  )::text;

  v_new_cipher := pgp_sym_encrypt(v_new_payload, v_key, 'compress-algo=1, cipher-algo=aes256');

  update public.orders
  set access_token_id = v_token_id,
      access_token_expires_at = v_token_expires_at,
      access_token_consumed_at = null,
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_requester, public.current_user_role(), 'order_credentials.token_created', 'order', p_order_id::text);

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_new_cipher, 'base64'),
    'expires_at', v_token_expires_at
  );
end;
$$;


CREATE OR REPLACE FUNCTION public.get_duo_account_access_token(p_account_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_cipher bytea;
  v_token_id uuid;
  v_expires_at timestamptz := now() + interval '5 minutes';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('get_duo_account_access_token', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, encrypted_credentials, reserved_by, reserved_order_id
  into v_account
  from public.duo_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_account.reserved_by is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_reserved_by_you');
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = v_account.reserved_order_id
      and o.assigned_booster_id = auth.uid()
      and o.status = 'in_progress'::public.order_status
  ) then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;
  if v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(decode(v_account.encrypted_credentials, 'base64'), v_key);
  exception when others then
    begin
      v_decrypted := pgp_sym_decrypt(v_account.encrypted_credentials::bytea, v_key);
    exception when others then
      return jsonb_build_object('success', false, 'error', 'decrypt_failed');
    end;
  end;

  begin
    v_payload := v_decrypted::jsonb;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
  end;
  if nullif(v_payload->>'login', '') is null or nullif(v_payload->>'password', '') is null then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
  end if;

  v_token_id := gen_random_uuid();

  v_cipher := pgp_sym_encrypt(jsonb_build_object(
    'v', 2,
    'kind', 'duo_account_access',
    'token_id', v_token_id,
    'account_id', p_account_id,
    'booster_id', auth.uid(),
    'order_id', v_account.reserved_order_id,
    'login', v_payload->>'login',
    'password', v_payload->>'password',
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text, v_key, 'compress-algo=1, cipher-algo=aes256');

  -- Substitui qualquer token anterior desta conta -- só um token ativo por
  -- vez, mesma regra da 102 pra credenciais de pedido.
  update public.duo_accounts
  set access_token_id = v_token_id,
      access_token_expires_at = v_expires_at,
      access_token_consumed_at = null,
      updated_at = now()
  where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.access_token_issued', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'access_token', encode(v_cipher, 'base64'), 'expires_at', v_expires_at);
end;
$$;


CREATE OR REPLACE FUNCTION public.resolve_order_access_token(p_access_token text, p_booster_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_order_id uuid;
  v_token_id uuid;
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
    if v_payload->>'v' <> '3'
       or v_payload->>'kind' <> 'riot_account_access'
       or nullif(v_payload->>'login', '') is null
       or nullif(v_payload->>'password', '') is null
       or nullif(v_payload->>'token_id', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_order_id := (v_payload->>'order_id')::uuid;
    v_token_id := (v_payload->>'token_id')::uuid;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, access_token_id, access_token_expires_at,
         access_token_consumed_at
  into v_order
  from public.orders
  where id = v_order_id
    and assigned_booster_id = p_booster_user_id
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

  if v_order.status is distinct from 'in_progress'::public.order_status then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;
  if v_order.payment_status is distinct from 'paid'::public.payment_status then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  -- Uso único: precisa ser exatamente o token ATIVO no momento (não um já
  -- superado por uma geração mais nova), nunca consumido antes, e ainda
  -- dentro dos 5 minutos -- qualquer uma dessas condições falhando invalida.
  if v_order.access_token_id is distinct from v_token_id
     or v_order.access_token_consumed_at is not null
     or v_order.access_token_expires_at is null
     or v_order.access_token_expires_at <= now()
     or (v_payload->>'expires_at')::timestamptz <= now()
     or (v_payload->>'customer_id')::uuid is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  -- Invalida imediatamente -- o mesmo token nunca mais resolve depois desta
  -- chamada, mesmo que a janela de 5 minutos ainda não tenha esgotado.
  update public.orders
  set access_token_id = null,
      access_token_consumed_at = now(),
      updated_at = now()
  where id = v_order.id;

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


CREATE OR REPLACE FUNCTION public.resolve_duo_account_access_token(p_access_token text, p_booster_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_account_id uuid;
  v_token_id uuid;
  v_account record;
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

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_payload := pgp_sym_decrypt(v_cipher, v_key)::jsonb;
    if v_payload->>'v' <> '2'
       or v_payload->>'kind' <> 'duo_account_access'
       or nullif(v_payload->>'login', '') is null
       or nullif(v_payload->>'password', '') is null
       or nullif(v_payload->>'token_id', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_account_id := (v_payload->>'account_id')::uuid;
    v_token_id := (v_payload->>'token_id')::uuid;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  if (v_payload->>'booster_id')::uuid is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;
  if (v_payload->>'expires_at')::timestamptz <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  if not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = p_booster_user_id and bp.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'booster_not_authorized');
  end if;

  select id, reserved_by, reserved_order_id, access_token_id, access_token_expires_at, access_token_consumed_at
  into v_account
  from public.duo_accounts where id = v_account_id for update;
  if not found or v_account.reserved_by is distinct from p_booster_user_id
     or v_account.reserved_order_id is distinct from (v_payload->>'order_id')::uuid then
    return jsonb_build_object('success', false, 'error', 'reservation_no_longer_valid');
  end if;

  if not exists (
    select 1 from public.orders o
    where o.id = v_account.reserved_order_id
      and o.assigned_booster_id = p_booster_user_id
      and o.status = 'in_progress'::public.order_status
  ) then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;

  -- Uso único: precisa ser exatamente o token_id ATIVO (não um já superado
  -- por uma emissão mais nova), nunca consumido antes, e ainda dentro da
  -- janela -- qualquer uma dessas condições falhando invalida.
  if v_account.access_token_id is distinct from v_token_id
     or v_account.access_token_consumed_at is not null
     or v_account.access_token_expires_at is null
     or v_account.access_token_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  -- Invalida imediatamente -- o mesmo token nunca mais resolve depois desta
  -- chamada, mesmo que a janela ainda não tenha esgotado.
  update public.duo_accounts
  set access_token_id = null,
      access_token_consumed_at = now(),
      updated_at = now()
  where id = v_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (p_booster_user_id, 'booster'::public.user_role, 'duo_account.access_token_resolved', 'duo_account', v_account_id::text);

  return jsonb_build_object(
    'success', true,
    'account_id', v_account_id,
    'login', v_payload->>'login',
    'password', v_payload->>'password'
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'invalid_token');
end;
$$;


CREATE OR REPLACE FUNCTION public.invalidate_login_tokens_on_order_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  if new.status is distinct from old.status
     or new.assigned_booster_id is distinct from old.assigned_booster_id then
    new.access_token_id := null;
    update public.duo_accounts
    set access_token_id = null, updated_at = now()
    where reserved_order_id = new.id and access_token_id is not null;
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION public.invalidate_login_tokens_on_order_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS invalidate_login_tokens_on_order_change ON public.orders;
CREATE TRIGGER invalidate_login_tokens_on_order_change
  BEFORE UPDATE OF status, assigned_booster_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_login_tokens_on_order_change();
