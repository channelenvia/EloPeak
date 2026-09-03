-- Revisão de segurança comparou o token de acesso de conta Duo
-- (get_duo_account_access_token / resolve_duo_account_access_token, migration
-- 056) com o equivalente pra credenciais de pedido, que a migration 102 já
-- endureceu pra uso único + 5 minutos. O token de conta Duo ficou pra trás:
-- continuava valendo por 12 HORAS e podia ser resgatado repetidas vezes
-- (resolve_duo_account_access_token nunca marcava o token como consumido).
--
-- O fluxo de uso é idêntico ao de credenciais de pedido (booster clica
-- "Obter token de acesso", copia, cola no launcher desktop que resgata na
-- hora via resolve-duo-account-credentials) -- não há motivo legítimo pra
-- essa janela ser 144x maior nem pra permitir reuso. Se o token vazar (log,
-- proxy, clipboard manager malicioso), ficava utilizável por até 12h.
--
-- Aplica o mesmo padrão da 102: token_id gerado a cada emissão, gravado em
-- colunas próprias na linha da conta, e resolve_duo_account_access_token
-- invalida o token_id ativo no primeiro resgate bem-sucedido.

alter table public.duo_accounts
  add column if not exists access_token_id uuid,
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists access_token_consumed_at timestamptz;

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

create or replace function public.resolve_duo_account_access_token(p_access_token text, p_booster_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
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
