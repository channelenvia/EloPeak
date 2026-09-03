-- Fluxo autoritativo e atômico para as contas usadas em Duo Boost.
-- Somente ranks de Ferro IV a Diamante I são comercialmente suportados.

create or replace function public.duo_account_rank_is_valid(p_rank jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_rank is not null
    and p_rank->>'tier' in ('iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond')
    and p_rank->>'division' in ('IV', 'III', 'II', 'I')
$$;

-- Contas antigas fora da faixa ficam em quarentena, nunca visíveis/acionáveis
-- pelo booster. O admin ainda pode corrigi-las pela tela.
update public.duo_accounts
set is_active = false, updated_at = now()
where is_active = true
  and not public.duo_account_rank_is_valid(current_rank);

alter table public.duo_accounts
  drop constraint if exists duo_accounts_active_rank_valid;
alter table public.duo_accounts
  add constraint duo_accounts_active_rank_valid check (
    not is_active or public.duo_account_rank_is_valid(current_rank)
  );

create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
      'has_credentials', encrypted_credentials is not null
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

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'current_rank', current_rank, 'is_active', is_active
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts
    where is_active = true
      and encrypted_credentials is not null
      and public.duo_account_rank_is_valid(current_rank);
  end if;

  return jsonb_build_object('success', true, 'accounts', v_accounts);
end;
$$;

create or replace function public.save_duo_account(
  p_account_id uuid,
  p_label text,
  p_tier text,
  p_division text,
  p_notes text,
  p_is_active boolean,
  p_login text default null,
  p_password text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_key text;
  v_rank jsonb;
  v_existing_credentials text;
  v_cipher text;
  v_is_create boolean := p_account_id is null;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if nullif(btrim(p_label), '') is null or char_length(btrim(p_label)) > 120 then
    return jsonb_build_object('success', false, 'error', 'invalid_label');
  end if;

  v_rank := jsonb_build_object('tier', lower(coalesce(p_tier, '')), 'division', upper(coalesce(p_division, '')));
  if not public.duo_account_rank_is_valid(v_rank) then
    return jsonb_build_object('success', false, 'error', 'rank_out_of_supported_range');
  end if;

  if (nullif(btrim(p_login), '') is null) <> (nullif(p_password, '') is null) then
    return jsonb_build_object('success', false, 'error', 'login_and_password_required_together');
  end if;
  if v_is_create and (nullif(btrim(p_login), '') is null or nullif(p_password, '') is null) then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;
  if nullif(btrim(p_login), '') is not null and (char_length(btrim(p_login)) > 160 or char_length(p_password) < 4 or char_length(p_password) > 256) then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials');
  end if;

  if not v_is_create then
    select encrypted_credentials into v_existing_credentials
    from public.duo_accounts where id = p_account_id for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'account_not_found');
    end if;
  end if;

  if nullif(btrim(p_login), '') is not null then
    select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'credential_key' limit 1;
    if v_key is null or char_length(v_key) < 32 then
      return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
    end if;
    v_cipher := encode(pgp_sym_encrypt(jsonb_build_object(
      'v', 2, 'login', btrim(p_login), 'password', p_password
    )::text, v_key, 'compress-algo=1, cipher-algo=aes256'), 'base64');
  else
    v_cipher := v_existing_credentials;
  end if;

  if p_is_active and v_cipher is null then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;

  if v_is_create then
    insert into public.duo_accounts(
      game_id, label, current_rank, notes, encrypted_credentials, is_active, created_by
    ) values (
      'lol', btrim(p_label), v_rank, nullif(btrim(p_notes), ''), v_cipher, p_is_active, auth.uid()
    ) returning id into v_id;
  else
    update public.duo_accounts set
      label = btrim(p_label), current_rank = v_rank,
      notes = nullif(btrim(p_notes), ''), encrypted_credentials = v_cipher,
      is_active = p_is_active, updated_at = now()
    where id = p_account_id
    returning id into v_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(),
    case when v_is_create then 'duo_account.created' else 'duo_account.updated' end,
    'duo_account', v_id::text);

  return jsonb_build_object('success', true, 'account_id', v_id);
end;
$$;

create or replace function public.set_duo_account_active(p_account_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  select id, current_rank, encrypted_credentials into v_account
  from public.duo_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if p_is_active and not public.duo_account_rank_is_valid(v_account.current_rank) then
    return jsonb_build_object('success', false, 'error', 'rank_out_of_supported_range');
  end if;
  if p_is_active and v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;
  update public.duo_accounts set is_active = p_is_active, updated_at = now()
  where id = p_account_id;
  return jsonb_build_object('success', true, 'account_id', p_account_id, 'is_active', p_is_active);
end;
$$;

create or replace function public.get_duo_account_credentials(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_parts text[];
  v_is_admin boolean := public.is_admin();
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  select id, is_active, current_rank, encrypted_credentials into v_account
  from public.duo_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  select exists (
    select 1 from public.booster_profiles
    where user_id = auth.uid() and status = 'approved'
  ) into v_is_booster;
  if not v_is_admin and not v_is_booster then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if not v_is_admin and (
    not v_account.is_active or not public.duo_account_rank_is_valid(v_account.current_rank)
  ) then
    return jsonb_build_object('success', false, 'error', 'account_unavailable');
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
    -- Compatibilidade com o formato bytea::text usado antes desta migration.
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

-- Toda escrita passa pelas RPCs acima; RLS permanece como defesa adicional.
revoke insert, update, delete on public.duo_accounts from authenticated;
revoke all on function public.set_duo_account_credentials(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_duo_accounts() from public, anon;
revoke all on function public.save_duo_account(uuid, text, text, text, text, boolean, text, text) from public, anon;
revoke all on function public.set_duo_account_active(uuid, boolean) from public, anon;
grant execute on function public.list_duo_accounts() to authenticated;
grant execute on function public.save_duo_account(uuid, text, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.set_duo_account_active(uuid, boolean) to authenticated;
