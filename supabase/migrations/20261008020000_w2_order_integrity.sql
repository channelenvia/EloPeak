-- W2: integridade do pedido e maquina de estados (C-05, H-03, H-04, H-05, H-06, H-39, M-15).
set search_path = public, extensions;

-- ===== M-15: ordem deterministica do historico =====
alter table public.order_status_history add column seq bigint generated always as identity;
create index order_status_history_order_seq_idx on public.order_status_history (order_id, seq);

-- ===== H-05: um payout por (pedido, booster); reatribuido tambem recebe =====
drop index if exists public.payout_records_order_unique_idx;
create unique index payout_records_order_booster_unique_idx on public.payout_records (order_id, booster_id);

-- ===== C-05 / H-05: so entra em completed com booster; completed e final (so refunded/disputed saem) =====
-- Trigger em vez de CHECK: producao tem 2 pedidos legados completed sem booster, que um CHECK travaria
-- em qualquer UPDATE. Reabrir pedido concluido exige fluxo explicito (nao existe hoje).
create or replace function public.trg_fn_orders_completed_guard()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.assigned_booster_id is null then
    raise exception 'completed order requires an assigned booster' using errcode = '23514';
  end if;
  if old.status = 'completed' and new.status not in ('completed', 'refunded', 'disputed') then
    raise exception 'completed order cannot be reopened' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke execute on function public.trg_fn_orders_completed_guard() from public, anon, authenticated;
create trigger trg_orders_completed_guard before update of status on public.orders
  for each row execute function public.trg_fn_orders_completed_guard();

-- ===== H-39: helper de pedidos em aberto do booster =====
create or replace function public.booster_has_open_orders(p_user_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.orders
    where assigned_booster_id = p_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'under_review', 'disputed')
  ) or exists (
    select 1 from public.orders
    where status = 'awaiting_assignment' and preferred_booster_id = p_user_id
      and (service_type = 'coaching' or exclusive_until > now())
  );
$$;
revoke execute on function public.booster_has_open_orders(uuid) from public, anon, authenticated;

-- ===== H-03: accept_boost_order volta a exigir booster aprovado =====
CREATE OR REPLACE FUNCTION public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         service_type, credentials_set, reassigned_by_admin
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if not public.is_approved_booster(p_booster_user_id) then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if v_order.preferred_booster_id is distinct from p_booster_user_id and exists (
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
     and v_order.preferred_booster_id <> p_booster_user_id
     and (
       v_order.service_type = 'coaching'
       or (v_order.exclusive_until is not null and v_order.exclusive_until > now())
     ) then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  if v_order.service_type = 'coaching' and v_order.preferred_booster_id = p_booster_user_id then
    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido de coaching reatribuído' else 'Booster aceitou o pedido de coaching' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', false, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null and v_order.exclusive_until > now();

  if v_is_exclusive then
    if not v_order.reassigned_by_admin and public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        used_exclusive_slot = not v_order.reassigned_by_admin,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido reatribuído' else 'Booster aceitou o pedido exclusivo' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', not v_order.reassigned_by_admin, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
  where id = p_order_id;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$function$;

-- ===== H-04: update_order_status so para o booster atribuido (admin usa o override) =====
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_actor record;
  v_to_status public.order_status;
  v_allowed boolean := false;
  v_effective_wins integer;
  v_local_start timestamp;
  v_unlock_local timestamp;
  v_unlock_at timestamptz;
begin
  if p_new_status is null or not exists (
       select 1 from unnest(enum_range(null::public.order_status)) e where e::text = p_new_status) then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played,
         losses_played, match_sync_started_at, target_rank
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
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

      if v_order.wins_purchased is not null then
        v_effective_wins := case
          when v_order.service_type = 'win_boost' then v_order.wins_played - v_order.losses_played
          else v_order.wins_played
        end;
        if v_effective_wins < v_order.wins_purchased then
          return jsonb_build_object('success', false, 'error', 'objective_not_reached');
        end if;
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
$function$;

create or replace function public.admin_override_order_status(p_order_id uuid, p_new_status text, p_reason text default 'Admin override')
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order record;
  v_actor record;
  v_to public.order_status;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_new_status is null or not exists (
       select 1 from unnest(enum_range(null::public.order_status)) e where e::text = p_new_status) then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  v_to := p_new_status::public.order_status;
  if v_to in ('awaiting_assignment', 'pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
  end if;

  select id, status, assigned_booster_id, payment_status into v_order
  from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  if v_order.status = v_to then
    return jsonb_build_object('success', false, 'error', 'no_status_change');
  end if;
  if v_order.status in ('completed', 'canceled', 'refunded') then
    return jsonb_build_object('success', false, 'error', 'order_terminal');
  end if;
  if v_order.status in ('drop_requested', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'use_resolution_flow');
  end if;
  if v_to = 'refunded' then
    return jsonb_build_object('success', false, 'error', 'use_refund_flow');
  end if;

  if v_to = 'canceled' then
    if v_order.assigned_booster_id is not null then
      return jsonb_build_object('success', false, 'error', 'use_cancel_in_progress_flow');
    end if;
  elsif v_to = 'completed' then
    if v_order.status not in ('awaiting_customer', 'disputed') then
      return jsonb_build_object('success', false, 'error', 'invalid_transition');
    end if;
    if v_order.assigned_booster_id is null then
      return jsonb_build_object('success', false, 'error', 'no_booster_assigned');
    end if;
    if v_order.payment_status <> 'paid' then
      return jsonb_build_object('success', false, 'error', 'order_not_paid');
    end if;
  elsif v_to in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'disputed') then
    if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'disputed') then
      return jsonb_build_object('success', false, 'error', 'invalid_transition');
    end if;
    if v_order.assigned_booster_id is null then
      return jsonb_build_object('success', false, 'error', 'no_booster_assigned');
    end if;
  else
    return jsonb_build_object('success', false, 'error', 'invalid_transition');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.orders set status = v_to, updated_at = now(),
         completed_at = case when v_to = 'completed' then now() else completed_at end
   where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to, auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
          jsonb_build_object('from', v_order.status, 'to', v_to, 'reason', v_reason));

  return jsonb_build_object('success', true);
end;
$function$;

-- ===== C-05 / H-06: conclusao pelo cliente (manual ou automatica apos 12 h) e contestacao =====
create or replace function public._complete_order_by_customer(p_order_id uuid, p_actor uuid, p_reason text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_booster uuid;
begin
  update public.orders set status = 'completed', completed_at = now(), updated_at = now()
   where id = p_order_id and status = 'awaiting_customer'
   returning assigned_booster_id into v_booster;
  if not found then
    raise exception 'order_not_awaiting_customer';
  end if;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_customer', 'completed', p_actor, p_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (v_booster, 'order_completed', 'Pedido concluido!',
          'O pedido foi concluido e seus ganhos foram liberados.',
          jsonb_build_object('order_id', p_order_id));
end;
$function$;
revoke execute on function public._complete_order_by_customer(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.confirm_order_completion(p_order_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order record;
begin
  if not public.check_own_write_rate_limit('confirm_order_completion', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'awaiting_customer' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'no_booster_assigned');
  end if;

  perform public._complete_order_by_customer(p_order_id, auth.uid(), 'Cliente confirmou a conclusão');
  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.dispute_order_completion(p_order_id uuid, p_reason text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order record;
  v_reason text := trim(p_reason);
begin
  if not public.check_own_write_rate_limit('dispute_order_completion', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'awaiting_customer' or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.orders set status = 'disputed', updated_at = now() where id = p_order_id;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_customer', 'disputed', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'order_disputed', 'Entrega contestada',
         'O cliente contestou a entrega do pedido. Verifique o chat do pedido.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';
  insert into public.notifications(user_id, type, title, body, data)
  values (v_order.assigned_booster_id, 'order_disputed', 'Entrega contestada',
          'O cliente contestou a entrega. Um administrador vai analisar.',
          jsonb_build_object('order_id', p_order_id));

  return jsonb_build_object('success', true);
end;
$function$;
grant execute on function public.dispute_order_completion(uuid, text) to authenticated;

-- RN-02: conclui sozinho 12 h depois de entrar em awaiting_customer (disputed suspende).
create or replace function public.auto_complete_awaiting_customer_orders()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.id, o.customer_id
    from public.orders o
    where o.status = 'awaiting_customer'
      and o.assigned_booster_id is not null
      and o.payment_status = 'paid'
      and coalesce((select max(h.created_at) from public.order_status_history h
                    where h.order_id = o.id and h.to_status = 'awaiting_customer'), o.updated_at)
          <= now() - interval '12 hours'
    for update of o skip locked
  loop
    begin
      perform public._complete_order_by_customer(v_order.id, v_order.customer_id,
        'Conclusão automática: o cliente não respondeu em 12 h');
      insert into public.notifications(user_id, type, title, body, data)
      values (v_order.customer_id, 'order_auto_completed', 'Pedido concluído automaticamente',
              'Passaram 12 h sem resposta, então o pedido foi marcado como concluído.',
              jsonb_build_object('order_id', v_order.id));
      v_count := v_count + 1;
    exception when others then
      -- um pedido problematico nao pode travar o lote inteiro
      raise warning 'auto_complete_awaiting_customer_orders: pedido % falhou: %', v_order.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$function$;
revoke execute on function public.auto_complete_awaiting_customer_orders() from public, anon, authenticated;
select cron.schedule('auto-complete-awaiting-customer-orders', '*/10 * * * *', 'select public.auto_complete_awaiting_customer_orders();');

-- C-05: botao de confirmar so com booster
CREATE OR REPLACE FUNCTION public.get_customer_order_state(p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer_id uuid := auth.uid();
  v_order record;
  v_requires_credentials boolean;
  v_is_active_paid boolean;
begin
  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_order_id is null then
    select id, status, payment_status, service_type, boost_mode, credentials_set, assigned_booster_id
    into v_order
    from public.orders
    where customer_id = v_customer_id
      and status = 'awaiting_payment'
    order by created_at desc
    limit 1;

    if not found then
      return jsonb_build_object('success', true, 'order_id', null);
    end if;
  else
    select id, status, payment_status, service_type, boost_mode, credentials_set, assigned_booster_id
    into v_order
    from public.orders
    where id = p_order_id
      and customer_id = v_customer_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'order_not_found');
    end if;
  end if;

  v_requires_credentials := public.order_requires_access_token(
    v_order.service_type,
    v_order.boost_mode
  );
  v_is_active_paid := v_order.payment_status = 'paid'::public.payment_status
    and v_order.status in (
      'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer', 'disputed'
    );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'can_pay', v_order.status = 'awaiting_payment'
      and coalesce(v_order.payment_status, 'pending'::public.payment_status) = 'pending'::public.payment_status,
    'payment_confirmed', v_is_active_paid,
    'requires_credentials', v_requires_credentials,
    'credentials_set', v_order.credentials_set,
    'can_submit_credentials', v_is_active_paid and v_requires_credentials,
    'can_confirm_completion', v_order.status = 'awaiting_customer' and v_order.assigned_booster_id is not null
  );
end;
$function$;

-- ===== H-39: status do booster com pedidos em aberto =====
create or replace function public.approve_booster(p_booster_id uuid, p_new_status text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor record;
  v_booster record;
  v_status public.booster_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_new_status not in ('pending', 'under_review', 'approved', 'rejected', 'suspended') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  v_status := p_new_status::public.booster_status;

  select id, user_id, status into v_booster
  from public.booster_profiles where id = p_booster_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  if v_booster.status = 'removed' then
    return jsonb_build_object('success', false, 'error', 'booster_removed');
  end if;
  if v_booster.status = v_status then
    return jsonb_build_object('success', true);
  end if;
  if v_status <> 'approved' and public.booster_has_open_orders(v_booster.user_id) then
    return jsonb_build_object('success', false, 'error', 'active_orders_exist');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set    status          = v_status,
         verified_at     = case when v_status = 'approved' then now() else null end,
         suspended_until = case when v_status = 'suspended' then now() + interval '24 hours' else null end,
         updated_at      = now()
  where  id = p_booster_id;

  update public.profiles
  set role = case when v_status = 'approved' then 'booster'::public.user_role else 'customer'::public.user_role end,
      updated_at = now()
  where id = v_booster.user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'booster.' || v_status::text, 'booster_profile', p_booster_id::text,
          jsonb_build_object('from', v_booster.status, 'to', v_status));

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.expel_booster(p_booster_id uuid, p_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor         record;
  v_booster       record;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, user_id, status into v_booster
  from public.booster_profiles where id = p_booster_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  if v_booster.status <> 'removed' then
    if public.booster_has_open_orders(v_booster.user_id) then
      return jsonb_build_object('success', false, 'error', 'active_orders_exist');
    end if;
  end if;

  select id, role into v_actor from public.profiles where id = p_actor_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'actor_not_found');
  end if;

  update public.booster_profiles
  set status = 'removed', suspended_until = null, updated_at = now()
  where id = p_booster_id;

  update public.profiles
  set role = 'customer'::public.user_role, updated_at = now()
  where id = v_booster.user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'booster.removed', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', trim(p_reason)));

  return jsonb_build_object('success', true, 'user_id', v_booster.user_id);
end;
$function$;
