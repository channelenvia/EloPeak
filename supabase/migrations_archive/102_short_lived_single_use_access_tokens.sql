-- O token de acesso mostrado ao booster (get_order_credentials) era
-- literalmente sempre o mesmo -- reencodava em base64 o MESMO
-- orders.game_credentials armazenado, válido por até 30 dias, e
-- resolve_order_access_token aceitava esse token quantas vezes quisesse
-- dentro da janela. Um token vazado continuava valendo por semanas.
--
-- Esta migration separa dois conceitos que estavam misturados na mesma
-- coluna:
--   1) game_credentials / credential_expires_at (30 dias) -- continuam sendo
--      o login/senha do cliente, criptografado UMA VEZ quando ele cadastra
--      (set_order_credentials, inalterado).
--   2) access_token_id / access_token_expires_at / access_token_consumed_at
--      (novo) -- o token de curta duração que o booster efetivamente usa
--      pra logar, derivado do login/senha acima.
--
-- get_order_credentials deixa de "mostrar" o token estático e passa a CRIAR
-- um novo a cada chamada: descriptografa o login/senha já cadastrado,
-- reencripta um payload novo com um token_id aleatório e expiração de 5
-- minutos, e substitui qualquer token anterior daquele pedido (só um token
-- ativo por vez). resolve_order_access_token (chamado pelo launcher via a
-- edge function resolve-order-credentials) só aceita o token_id que estiver
-- marcado como ativo no pedido, nunca consumido antes e dentro dos 5
-- minutos -- e invalida na hora do primeiro uso bem-sucedido (uso único de
-- verdade, não só limitado por tempo).

alter table public.orders
  add column if not exists access_token_id uuid,
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists access_token_consumed_at timestamptz;

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

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
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

revoke all on function public.resolve_order_access_token(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_order_access_token(text, uuid) to service_role;

revoke all on function public.get_order_credentials(uuid) from public, anon;
grant execute on function public.get_order_credentials(uuid) to authenticated;
