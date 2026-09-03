-- Reconciliação de drift: estes objetos já existem em produção (aplicados
-- fora do histórico de migrations, provavelmente direto pelo SQL editor) mas
-- não tinham nenhuma migration correspondente no repositório. Sem isso,
-- `supabase db reset`/um ambiente novo a partir das migrations não teria
-- chat funcional (send_order_message/get_order_chat ausentes), nem o evento
-- de "novo job disponível" que useNewOrderSound.ts escuta via Realtime.
--
-- Todo o SQL abaixo é idempotente e reproduz exatamente o que já roda em
-- produção — não muda nenhum comportamento, só passa a rastrear o que já
-- existia.

-- ─── booster_order_events ──────────────────────────────────────────────────
-- Log de eventos "pedido ficou disponível" para boosters aprovados ouvirem
-- via Realtime (useNewOrderSound.ts). Populado só pelo trigger abaixo.

create table if not exists public.booster_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.booster_order_events enable row level security;

drop policy if exists "approved_boosters_read_order_events" on public.booster_order_events;
create policy "approved_boosters_read_order_events" on public.booster_order_events
  for select using (public.is_approved_booster());

revoke all on public.booster_order_events from public, anon;
grant select on public.booster_order_events to authenticated;
grant insert, select, update, delete, truncate, references, trigger on public.booster_order_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'booster_order_events'
  ) then
    alter publication supabase_realtime add table public.booster_order_events;
  end if;
end $$;

create or replace function public.notify_boosters_order_available()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'awaiting_assignment' then
    if tg_op = 'INSERT' then
      insert into public.booster_order_events (order_id) values (new.id);
    elsif old.status is distinct from 'awaiting_assignment' then
      insert into public.booster_order_events (order_id) values (new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_boosters_order_available on public.orders;
create trigger trg_notify_boosters_order_available
  after insert or update of status on public.orders
  for each row execute function public.notify_boosters_order_available();

-- ─── Chat (order_messages já existe desde a migration 034; só as funções
-- que o consomem ficaram sem registro) ──────────────────────────────────────

create or replace function public.get_order_chat(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_messages jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.assigned_booster_id is not null then
    select coalesce(jsonb_agg(row_data order by row_data->>'created_at'), '[]'::jsonb)
    into v_messages
    from (
      select jsonb_build_object(
        'id', m.id,
        'order_id', m.order_id,
        'sender_id', m.sender_id,
        'sender_role', m.sender_role,
        'sender_name', case
          when m.sender_role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
          when m.sender_role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
          else coalesce(p.username, 'Cliente')
        end,
        'sender_avatar_url', p.avatar_url,
        'content', m.content,
        'created_at', m.created_at
      ) as row_data
      from (
        select om.*
        from public.order_messages om
        where om.order_id = p_order_id
        order by om.created_at desc
        limit 300
      ) m
      join public.profiles p on p.id = m.sender_id
      left join public.booster_profiles bp
        on bp.user_id = m.sender_id
       and m.sender_role = 'booster'::public.user_role
    ) messages;
  end if;

  return jsonb_build_object(
    'success', true,
    'chat_available', v_order.assigned_booster_id is not null,
    'chat_locked', v_order.chat_locked,
    'chat_locked_at', v_order.chat_locked_at,
    'can_send',
      v_order.assigned_booster_id is not null
      and (v_role = 'admin'::public.user_role or not v_order.chat_locked),
    'messages', v_messages
  );
end;
$$;

create or replace function public.send_order_message(p_order_id uuid, p_content text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_message_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'code', 'chat_unavailable', 'message', 'O chat sera liberado quando um booster for atribuido.');
  end if;

  if v_order.chat_locked and v_role <> 'admin'::public.user_role then
    return jsonb_build_object('success', false, 'code', 'chat_locked', 'message', 'O chat foi bloqueado pela administracao.');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'A mensagem deve ter entre 1 e 4000 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('order_chat:' || p_order_id::text, 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  end if;

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read)
  values (p_order_id, v_user_id, v_role, v_content, false)
  returning id into v_message_id;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$$;

create or replace function public.admin_set_order_chat_lock(p_order_id uuid, p_locked boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('success', false, 'code', 'forbidden', 'message', 'Apenas administradores podem controlar o chat.');
  end if;

  update public.orders
  set chat_locked = p_locked,
      chat_locked_by = case when p_locked then v_user_id else null end,
      chat_locked_at = case when p_locked then now() else null end,
      updated_at = now()
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (
    v_user_id,
    'admin'::public.user_role,
    case when p_locked then 'order_chat_locked' else 'order_chat_unlocked' end,
    'order',
    p_order_id,
    jsonb_build_object('chat_locked', p_locked)
  );

  return jsonb_build_object('success', true, 'chat_locked', p_locked);
end;
$$;

revoke all on function public.get_order_chat(uuid) from public, anon;
revoke all on function public.send_order_message(uuid, text) from public, anon;
revoke all on function public.admin_set_order_chat_lock(uuid, boolean) from public, anon;
grant execute on function public.get_order_chat(uuid) to authenticated;
grant execute on function public.send_order_message(uuid, text) to authenticated;
grant execute on function public.admin_set_order_chat_lock(uuid, boolean) to authenticated;

-- ─── Contas Duo (criptografia AES-256 via pgp_sym_encrypt + Supabase Vault,
-- chave nunca sai do banco; login/senha nunca vão para o booster — só as
-- funções ficaram sem registro) ─────────────────────────────────────────────

create or replace function public.duo_account_rank_is_valid(p_rank jsonb)
returns boolean
language sql immutable set search_path = public as $$
  select p_rank is not null
    and p_rank->>'tier' in ('iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond')
    and p_rank->>'division' in ('IV', 'III', 'II', 'I')
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
language plpgsql security definer set search_path = public, extensions as $$
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
language plpgsql security definer set search_path = public as $$
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

revoke all on function public.save_duo_account(uuid, text, text, text, text, boolean, text, text) from public, anon;
revoke all on function public.set_duo_account_active(uuid, boolean) from public, anon;
grant execute on function public.save_duo_account(uuid, text, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.set_duo_account_active(uuid, boolean) to authenticated;
