-- 169_order_account_section_admin_access.sql
-- Duas mudanças pro backend do redesign da seção "Conta do pedido" (ver
-- docs/superpowers/specs/2026-08-08-order-detail-credentials-section-and-match-history-design.md):
--
-- 1) Nova função get_order_duo_partner_riot_id -- expõe ao CLIENTE (e ao
--    admin) o Riot ID da conta duo escolhida pelo booster pro pedido, sem
--    NUNCA tocar em login/senha de duo_accounts (essas colunas continuam
--    admin-only). Junta os dois casos possíveis (booster usando conta
--    própria vs. reservando uma da plataforma) numa única leitura.
--
-- 2) get_order_credentials ganha um caminho de autorização pro admin --
--    hoje só customer_id/assigned_booster_id conseguem gerar/revelar o
--    token de acesso de 5 minutos; o admin nunca teve essa capacidade.
--    Redefinição completa (create or replace), corpo idêntico ao definido
--    em migrations_archive/102_short_lived_single_use_access_tokens.sql,
--    só com a condição de autorização ampliada.

create or replace function public.get_order_duo_partner_riot_id(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  select customer_id, duo_own_riot_id into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  if v_order.customer_id is distinct from auth.uid() and not public.is_admin() then
    return null;
  end if;

  return coalesce(
    v_order.duo_own_riot_id,
    (select riot_id from public.duo_accounts where reserved_order_id = p_order_id)
  );
end;
$$;

revoke all on function public.get_order_duo_partner_riot_id(uuid) from public, anon;
grant execute on function public.get_order_duo_partner_riot_id(uuid) to authenticated;

create or replace function public.get_order_credentials(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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

  -- Substitui qualquer token anterior deste pedido -- só um token ativo por
  -- vez; gerar um novo invalida silenciosamente o antigo mesmo que ainda
  -- não tenha expirado nem sido usado.
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
