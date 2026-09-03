-- Contas Duo: reserva exclusiva + acesso via token opaco (nunca login/senha
-- crus no navegador do booster).
--
-- Causa raiz do problema de segurança: get_duo_account_credentials() já
-- decifrava e devolvia login/senha em texto puro para QUALQUER booster
-- aprovado, para QUALQUER conta ativa — sem nenhuma reserva/exclusividade.
-- src/features/booster/pages/Accounts.tsx renderizava isso direto no DOM
-- ("Revelar"). Duas correções nesta migration:
--
-- 1. Reserva exclusiva: duo_accounts ganha reserved_by/reserved_order_id/
--    reserved_at. reserve_duo_account() é atômica (UPDATE condicional,
--    nunca "SELECT depois UPDATE"), então dois boosters não conseguem
--    reservar a mesma conta. list_duo_accounts() só mostra pro booster
--    contas livres ou já reservadas por ele mesmo.
-- 2. Acesso via token opaco: get_duo_account_access_token() só funciona se
--    o chamador for quem reservou a conta, e devolve um token cifrado
--    (mesmo padrão de set_order_credentials/resolve_order_access_token) —
--    nunca login/senha direto. resolve_duo_account_access_token() (chamada
--    só pela edge function resolve-duo-account-credentials, nunca direto do
--    browser) é quem de fato decifra, sempre re-checando que a reserva
--    ainda é válida no momento do resgate.
--
-- get_duo_account_credentials() continua existindo só para admin gerenciar
-- a conta (editar/cadastrar) — o branch de booster foi removido.

alter table public.duo_accounts
  add column if not exists reserved_by uuid references public.booster_profiles(user_id),
  add column if not exists reserved_order_id uuid references public.orders(id),
  add column if not exists reserved_at timestamptz;

create index if not exists duo_accounts_reserved_by_idx
  on public.duo_accounts(reserved_by) where reserved_by is not null;
create unique index if not exists duo_accounts_reserved_order_uidx
  on public.duo_accounts(reserved_order_id) where reserved_order_id is not null;

-- ─── Reserva ────────────────────────────────────────────────────────────────

create or replace function public.reserve_duo_account(p_order_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_previous_account_id uuid;
  v_reserved_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id, boost_mode, status into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_order_status');
  end if;

  select id into v_previous_account_id
  from public.duo_accounts where reserved_order_id = p_order_id for update;

  if v_previous_account_id is not null and v_previous_account_id = p_account_id then
    return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', true);
  end if;

  -- Troca: a chamada em si já é a ação explícita do booster; registra no
  -- audit_logs pra manter histórico de qual conta foi usada quando.
  if v_previous_account_id is not null then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where id = v_previous_account_id;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'booster'::public.user_role, 'duo_account.switched', 'order', p_order_id,
            jsonb_build_object('from_account_id', v_previous_account_id, 'to_account_id', p_account_id,
                                'order_status_at_switch', v_order.status));
  end if;

  update public.duo_accounts
  set reserved_by = auth.uid(), reserved_order_id = p_order_id, reserved_at = now()
  where id = p_account_id
    and reserved_by is null
    and is_active = true
    and public.duo_account_rank_is_valid(current_rank)
  returning id into v_reserved_id;

  if v_reserved_id is null then
    return jsonb_build_object('success', false, 'error', 'account_unavailable');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'duo_account.reserved', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', false);
end;
$$;

create or replace function public.release_duo_account_reservation(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id into v_order from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

-- Reserva abandonada / conta presa por engano — só admin.
create or replace function public.admin_release_duo_account(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where id = p_account_id;

  if not found then return jsonb_build_object('success', false, 'error', 'account_not_found'); end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'duo_account.admin_released', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- Devolve a conta automaticamente quando o pedido termina (concluído,
-- cancelado ou reembolsado — disputa mantém a reserva até resolução manual).
create or replace function public.trg_fn_release_duo_account_on_order_end()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('completed', 'canceled', 'refunded') and old.status is distinct from new.status then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_release_duo_account_on_order_end
  after update of status on public.orders
  for each row execute function public.trg_fn_release_duo_account_on_order_end();

-- ─── list_duo_accounts: reservation-aware ──────────────────────────────────

create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_accounts jsonb;
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'game_id', game_id, 'label', label,
      'current_rank', current_rank, 'notes', notes, 'is_active', is_active,
      'created_by', created_by, 'created_at', created_at, 'updated_at', updated_at,
      'has_credentials', encrypted_credentials is not null,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id, 'reserved_at', reserved_at
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts;
  else
    select exists (
      select 1 from public.booster_profiles
      where user_id = auth.uid() and status = 'approved'
    ) into v_is_booster;

    if not v_is_booster then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

    -- Só contas livres ou já reservadas pelo próprio booster — uma conta
    -- reservada por outro booster desaparece da lista dele.
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'current_rank', current_rank, 'is_active', is_active,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts
    where is_active = true
      and encrypted_credentials is not null
      and public.duo_account_rank_is_valid(current_rank)
      and (reserved_by is null or reserved_by = auth.uid());
  end if;

  return jsonb_build_object('success', true, 'accounts', v_accounts);
end;
$$;

-- ─── Credenciais: só admin vê login/senha direto; booster usa token ────────

create or replace function public.get_duo_account_credentials(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_parts text[];
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, encrypted_credentials into v_account
  from public.duo_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
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
    if nullif(v_payload->>'login', '') is null or nullif(v_payload->>'password', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
    end if;
  exception when others then
    v_parts := string_to_array(v_decrypted, '|');
    if array_length(v_parts, 1) < 2 then
      return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
    end if;
    v_payload := jsonb_build_object('login', v_parts[1], 'password', v_parts[2]);
  end;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.credentials_viewed', 'duo_account', p_account_id::text);
  return jsonb_build_object('success', true, 'login', v_payload->>'login', 'password', v_payload->>'password');
end;
$$;

-- Booster: emite um token cifrado e efêmero (12h) em vez de login/senha
-- direto. Só funciona se a conta estiver reservada por ele.
create or replace function public.get_duo_account_access_token(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_cipher bytea;
  v_expires_at timestamptz := now() + interval '12 hours';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, encrypted_credentials, reserved_by, reserved_order_id
  into v_account
  from public.duo_accounts where id = p_account_id;
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

  v_cipher := pgp_sym_encrypt(jsonb_build_object(
    'v', 2,
    'kind', 'duo_account_access',
    'account_id', p_account_id,
    'booster_id', auth.uid(),
    'order_id', v_account.reserved_order_id,
    'login', v_payload->>'login',
    'password', v_payload->>'password',
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text, v_key, 'compress-algo=1, cipher-algo=aes256');

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.access_token_issued', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'access_token', encode(v_cipher, 'base64'), 'expires_at', v_expires_at);
end;
$$;

-- Chamada só pela edge function resolve-duo-account-credentials (nunca
-- direto do browser) — re-verifica que a reserva ainda é válida no momento
-- do resgate, não só no momento da emissão do token.
create or replace function public.resolve_duo_account_access_token(p_access_token text, p_booster_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_account_id uuid;
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
       or nullif(v_payload->>'password', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_account_id := (v_payload->>'account_id')::uuid;
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

  select id, reserved_by, reserved_order_id into v_account
  from public.duo_accounts where id = v_account_id;
  if not found or v_account.reserved_by is distinct from p_booster_user_id
     or v_account.reserved_order_id is distinct from (v_payload->>'order_id')::uuid then
    return jsonb_build_object('success', false, 'error', 'reservation_no_longer_valid');
  end if;

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

revoke all on function public.reserve_duo_account(uuid, uuid) from public, anon;
revoke all on function public.release_duo_account_reservation(uuid) from public, anon;
revoke all on function public.admin_release_duo_account(uuid) from public, anon;
revoke all on function public.get_duo_account_access_token(uuid) from public, anon;
revoke all on function public.resolve_duo_account_access_token(text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_duo_account(uuid, uuid) to authenticated;
grant execute on function public.release_duo_account_reservation(uuid) to authenticated;
grant execute on function public.admin_release_duo_account(uuid) to authenticated;
grant execute on function public.get_duo_account_access_token(uuid) to authenticated;
grant execute on function public.resolve_duo_account_access_token(text, uuid) to service_role;
