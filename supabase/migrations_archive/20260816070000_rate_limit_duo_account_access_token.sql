-- Auditoria de segurança (2026-08-16): a migration 20260815050000 já limitou
-- get_order_credentials/set_order_credentials porque fazem pgp_sym_encrypt/
-- decrypt a cada chamada (custo de CPU por chamada). get_duo_account_access_token
-- (migration 104_duo_account_token_single_use) faz exatamente a mesma operação
-- sobre duo_accounts.encrypted_credentials e ficou de fora daquela varredura --
-- um booster com uma conta duo reservada podia chamar repetidamente sem
-- nenhum throttle. Mesmo padrão/limite de get_order_credentials.

create or replace function public.get_duo_account_access_token(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
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
