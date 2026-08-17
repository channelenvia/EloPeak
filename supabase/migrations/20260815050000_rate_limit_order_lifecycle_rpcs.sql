-- Auditoria geral (2026-08-15): check_own_write_rate_limit já existe (criado
-- em 009_security_hardening_and_aggregates.sql) e é usado por chat/review/
-- coaching_topic, mas nunca foi estendido pras RPCs de ciclo de vida do
-- pedido chamadas direto do cliente via supabase.rpc() -- sem edge function
-- na frente, então sem o rate limit por IP/usuário que protege create-pix-
-- payment, resolve-order-credentials etc. Fecha essa lacuna nas 6 RPCs mais
-- expostas: accept_boost_order (hot path de todo booster olhando a fila),
-- update_order_status, set_order_credentials/get_order_credentials (fazem
-- pgp_sym_encrypt/decrypt -- custo de CPU por chamada) e as duas de drop
-- request. admin_drop_order/resolve_drop_request ficam de fora -- só admin
-- chama, ação já é rara e confiável.

create or replace function public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('accept_boost_order', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = p_order_id and dr.booster_id = p_booster_user_id and dr.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'previously_dropped_by_you');
  end if;
  if public.order_requires_access_token(v_order.service_type, v_order.boost_mode)
     and not v_order.credentials_set then
    return jsonb_build_object('success', false, 'error', 'missing_access_token');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.exclusive_until is not null
     and v_order.exclusive_until > now()
     and v_order.preferred_booster_id <> p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null
    and v_order.exclusive_until > now();

  if v_is_exclusive then
    if public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'assigned', assigned_booster_id = p_booster_user_id, used_exclusive_slot = true, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido exclusivo');

    return jsonb_build_object('success', true, 'details', jsonb_build_object('used_exclusive_slot', true));
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'assigned', assigned_booster_id = p_booster_user_id, updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;

create or replace function public.update_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_to_status public.order_status;
  v_allowed boolean := false;
  v_local_start timestamp;
  v_unlock_local timestamp;
  v_unlock_at timestamptz;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played,
         losses_played, match_sync_started_at, target_rank
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    if v_to_status = 'awaiting_assignment' then
      return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
    end if;

    update public.orders set status = v_to_status, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, auth.uid(), coalesce(p_reason, 'Admin status update'));

    return jsonb_build_object('success', true);
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('update_order_status', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  v_allowed := case
    when v_order.status = 'assigned'          and v_to_status = 'in_progress' then true
    when v_order.status = 'in_progress'       and v_to_status in ('paused', 'awaiting_customer') then true
    when v_order.status = 'paused'            and v_to_status in ('in_progress', 'awaiting_customer') then true
    when v_order.status = 'awaiting_customer' and v_to_status in ('in_progress', 'paused') then true
    else false
  end;

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', 'invalid_transition');
  end if;

  if v_to_status = 'awaiting_customer' and v_order.service_type <> 'coaching' then
    if v_order.target_rank is not null then
      return jsonb_build_object('success', false, 'error', 'requires_rank_verification');
    end if;

    if v_order.service_type = 'clash' then
      if v_order.match_sync_started_at is null then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;

      v_local_start := v_order.match_sync_started_at at time zone 'America/Sao_Paulo';
      v_unlock_local := date_trunc('day', v_local_start) + interval '23 hours';
      if v_unlock_local < v_local_start then
        v_unlock_local := v_unlock_local + interval '1 day';
      end if;
      v_unlock_at := v_unlock_local at time zone 'America/Sao_Paulo';

      if now() < v_unlock_at then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;
    else
      if (v_order.wins_played + v_order.losses_played) < 1 then
        return jsonb_build_object('success', false, 'error', 'no_matches_played');
      end if;

      if v_order.wins_purchased is not null and v_order.wins_played < v_order.wins_purchased then
        return jsonb_build_object('success', false, 'error', 'objective_not_reached');
      end if;
    end if;
  end if;

  update public.orders set
    status = v_to_status,
    updated_at = now(),
    match_sync_started_at = case
      when v_order.status = 'assigned' and v_to_status = 'in_progress'
        then coalesce(match_sync_started_at, now())
      else match_sync_started_at
    end
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.set_order_credentials(
  p_order_id uuid,
  p_login text,
  p_password text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_key text;
  v_payload text;
  v_cipher bytea;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('set_order_credentials', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, customer_id, status, payment_status, service_type, boost_mode
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if nullif(btrim(p_login), '') is null or char_length(btrim(p_login)) > 160 then
    return jsonb_build_object('success', false, 'error', 'invalid_login');
  end if;

  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 256 then
    return jsonb_build_object('success', false, 'error', 'invalid_password');
  end if;

  select decrypted_secret
  into v_key
  from vault.decrypted_secrets
  where name = 'credential_key'
  limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  v_payload := jsonb_build_object(
    'v', 2,
    'kind', 'riot_account_access',
    'order_id', v_order.id,
    'customer_id', v_order.customer_id,
    'login', btrim(p_login),
    'password', p_password,
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text;

  v_cipher := pgp_sym_encrypt(
    v_payload,
    v_key,
    'compress-algo=1, cipher-algo=aes256'
  );

  update public.orders
  set game_credentials = v_cipher::text,
      credentials_set = true,
      credential_expires_at = v_expires_at,
      updated_at = now()
  where id = v_order.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'customer'::public.user_role, 'order_credentials.set', 'order', v_order.id::text);

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_cipher, 'base64'),
    'expires_at', v_expires_at
  );
end;
$$;

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

create or replace function public.request_order_drop(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_existing       uuid;
  v_completion_pct numeric;
  v_is_top3        boolean;
  v_share_pct      numeric;
  v_preview_payout numeric;
begin
  if not public.check_own_write_rate_limit('request_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played, total_price, last_match_synced_at, drop_count
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'in_progress' then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;
  if v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if v_order.drop_count >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3 from public.booster_profiles where user_id = auth.uid();
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, auth.uid(), v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'booster', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), v_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$$;

create or replace function public.request_customer_order_drop(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_existing       uuid;
  v_completion_pct numeric;
  v_is_top3        boolean;
  v_share_pct      numeric;
  v_preview_payout numeric;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id, wins_played, losses_played, total_price, drop_count
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.drop_count >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'customer', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop', 'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$$;
