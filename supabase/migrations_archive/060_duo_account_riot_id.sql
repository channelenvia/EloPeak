-- Contas Duo agora guardam o Riot ID usado para consultar rank/PDL antes do
-- admin cadastrar login/senha — o mesmo fluxo que o cliente já usa em
-- StepConfigure.tsx (edge function riot-account-rank), só que disparado pelo
-- admin. riot_id é só um identificador de conta, não uma credencial —
-- visível apenas para admins (list_duo_accounts não expõe pro booster).
alter table public.duo_accounts add column if not exists riot_id text;

create or replace function public.save_duo_account(
  p_account_id uuid,
  p_label text,
  p_tier text,
  p_division text,
  p_notes text,
  p_is_active boolean,
  p_login text default null,
  p_password text default null,
  p_riot_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
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
  if p_riot_id is not null and char_length(btrim(p_riot_id)) > 40 then
    return jsonb_build_object('success', false, 'error', 'invalid_riot_id');
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
      game_id, label, current_rank, notes, encrypted_credentials, is_active, created_by, riot_id
    ) values (
      'lol', btrim(p_label), v_rank, nullif(btrim(p_notes), ''), v_cipher, p_is_active, auth.uid(), nullif(btrim(p_riot_id), '')
    ) returning id into v_id;
  else
    update public.duo_accounts set
      label = btrim(p_label), current_rank = v_rank,
      notes = nullif(btrim(p_notes), ''), encrypted_credentials = v_cipher,
      is_active = p_is_active, riot_id = coalesce(nullif(btrim(p_riot_id), ''), riot_id), updated_at = now()
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

create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
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
      'id', id, 'game_id', game_id, 'label', label, 'riot_id', riot_id,
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
