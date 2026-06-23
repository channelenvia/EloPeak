-- ============================================================
-- Migration 003 — Credenciais de conta, limite de slots e chat do admin
-- ============================================================

-- ─── 1. Credenciais de conta no pedido ───────────────────────────────────────
-- Armazena login + senha da conta do cliente, criptografados com pgp_sym_encrypt.
-- A chave de criptografia vem de um segredo do servidor (nunca do cliente).

alter table public.orders
  add column if not exists game_credentials text,       -- texto criptografado via pgp_sym_encrypt
  add column if not exists credentials_set  boolean not null default false;

-- RPC: set_order_credentials (cliente define as credenciais do pedido)
-- Usa o Supabase Vault para leitura da chave — sem permissão de superusuário necessária.
create or replace function public.set_order_credentials(
  p_order_id uuid,
  p_login    text,
  p_password text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_key   text;
begin
  select id, customer_id, status into v_order
  from   public.orders
  where  id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.status in ('completed', 'canceled', 'refunded', 'disputed') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  -- Lê a chave do Vault (cadastrada com vault.create_secret)
  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  update public.orders
  set
    game_credentials = pgp_sym_encrypt(p_login || '|' || p_password, v_key),
    credentials_set  = true,
    updated_at       = now()
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: get_order_credentials (apenas booster atribuído ou admin pode ler)
create or replace function public.get_order_credentials(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order     record;
  v_key       text;
  v_decrypted text;
  v_parts     text[];
begin
  select id, customer_id, assigned_booster_id, game_credentials, credentials_set
  into   v_order
  from   public.orders
  where  id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not v_order.credentials_set or v_order.game_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  -- Lê a chave do Vault
  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(v_order.game_credentials::bytea, v_key);
  exception when others then
    return jsonb_build_object('success', false, 'error', 'decrypt_failed');
  end;

  v_parts := string_to_array(v_decrypted, '|');

  return jsonb_build_object(
    'success', true,
    'login',    v_parts[1],
    'password', v_parts[2]
  );
end;
$$;

grant execute on function public.set_order_credentials(uuid, text, text, text) to authenticated;
grant execute on function public.get_order_credentials(uuid)                   to authenticated;

-- ─── 2. Atualizar limite de slots (booster normal: max 3 total, max 1 duo) ───

create or replace function public.can_booster_accept_order(
  p_booster_user_id uuid,
  p_boost_mode      text
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_top5     boolean;
  v_max_total   integer;
  v_max_duo     integer;
  v_solo_count  integer;
  v_duo_count   integer;
  v_total_count integer;
begin
  select is_top5 into v_is_top5
  from public.booster_profiles
  where user_id = p_booster_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'booster_not_approved');
  end if;

  -- Normal: 3 pedidos total, máx 1 duo
  -- Top5:   3 pedidos total, máx 2 duo
  if v_is_top5 then
    v_max_total := 3; v_max_duo := 2;
  else
    v_max_total := 3; v_max_duo := 1;
  end if;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top5', v_is_top5
    );
  end if;

  if p_boost_mode = 'duo' and v_duo_count >= v_max_duo then
    return jsonb_build_object(
      'allowed', false, 'reason', 'duo_slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top5', v_is_top5
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'max_duo', v_max_duo, 'is_top5', v_is_top5
  );
end;
$$;

-- ─── 3. Permitir admin enviar mensagens no chat do pedido ─────────────────────

-- Remover a policy restritiva de insert e recriar com suporte ao admin
drop policy if exists "order_messages_insert" on public.order_messages;

create policy "order_messages_insert" on public.order_messages for insert with check (
  sender_id = auth.uid()
  and (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
    )
    or public.is_admin()
  )
);

-- ─── 4. Requer extensão pgcrypto ─────────────────────────────────────────────
create extension if not exists pgcrypto;
