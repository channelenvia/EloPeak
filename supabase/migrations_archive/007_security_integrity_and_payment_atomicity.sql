-- Security and integrity hardening. Forward-only and non-destructive.

-- New writes must respect financial/domain invariants. NOT VALID avoids
-- blocking deployment because of unknown legacy rows while still enforcing
-- every insert/update after this migration.
alter table public.orders
  add constraint orders_prices_nonnegative check (base_price >= 0 and extras_price >= 0 and total_price >= 0) not valid,
  add constraint orders_price_sum check (total_price = round(base_price + extras_price, 2)) not valid,
  add constraint orders_match_counters_nonnegative check (wins_played >= 0 and losses_played >= 0) not valid;

alter table public.payments
  add constraint payments_amount_positive check (amount > 0) not valid,
  add constraint payments_refund_range check (refunded_amount >= 0 and refunded_amount <= amount) not valid;

alter table public.refunds
  add constraint refunds_amount_positive check (amount > 0) not valid;

alter table public.payout_records
  add constraint payout_amounts_nonnegative check (
    gross_amount >= 0 and commission_amount >= 0 and net_amount >= 0
    and commission_rate between 0 and 1
  ) not valid;

alter table public.service_extras
  add constraint service_extras_modifiers_nonnegative check (
    price_modifier >= 0 and price_modifier_pct between 0 and 100
  ) not valid;

alter table public.master_plus_pricing
  add constraint master_plus_price_positive check (price is null or price > 0) not valid;

alter table public.booster_services
  add constraint booster_services_price_nonnegative check (price >= 0) not valid;

alter table public.order_messages
  add constraint order_messages_content_length check (char_length(btrim(content)) between 1 and 4000) not valid;

alter table public.ticket_messages
  add constraint ticket_messages_content_length check (char_length(btrim(content)) between 1 and 4000) not valid;

alter table public.reviews
  add constraint reviews_content_length check (content is null or char_length(content) <= 2000) not valid;

alter table public.support_tickets
  add constraint support_tickets_subject_length check (char_length(btrim(subject)) between 1 and 200) not valid;

create unique index if not exists payments_order_unique_idx on public.payments(order_id);
create unique index if not exists payout_records_order_unique_idx on public.payout_records(order_id);
create unique index if not exists order_drop_requests_one_pending_idx
  on public.order_drop_requests(order_id) where status = 'pending';

-- Direct inserts into trust-bearing rows are either removed or constrained.
drop policy if exists "booster_profiles_insert_own" on public.booster_profiles;

drop policy if exists "customer_profiles_insert_own" on public.customer_profiles;
create policy "customer_profiles_insert_own" on public.customer_profiles for insert
  with check (user_id = auth.uid() and total_orders = 0 and total_spent = 0);

drop policy if exists "tickets_customer_insert" on public.support_tickets;
create policy "tickets_customer_insert" on public.support_tickets for insert
  with check (
    customer_id = auth.uid()
    and status = 'open'
    and priority = 'medium'
    and assigned_to is null
    and resolved_at is null
    and (
      order_id is null or exists (
        select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()
      )
    )
  );

drop policy if exists "order_messages_insert" on public.order_messages;
create policy "order_messages_insert" on public.order_messages for insert with check (
  sender_id = auth.uid()
  and sender_role = public.current_user_role()
  and exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "ticket_messages_insert" on public.ticket_messages;
create policy "ticket_messages_insert" on public.ticket_messages for insert with check (
  sender_id = auth.uid()
  and sender_role = public.current_user_role()
  and (is_internal = false or public.is_admin())
  and (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.customer_id = auth.uid() or t.assigned_to = auth.uid())
    )
    or public.is_admin()
  )
);

drop policy if exists "reviews_customer_insert" on public.reviews;
create policy "reviews_customer_insert" on public.reviews for insert with check (
  customer_id = auth.uid()
  and is_moderated = false
  and admin_note is null
  and exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.customer_id = auth.uid()
      and o.status = 'completed'
      and o.assigned_booster_id = booster_id
  )
);

drop policy if exists "Anyone can submit an application" on public.booster_applications;
revoke insert on public.booster_applications from anon;
create policy "users_submit_own_application" on public.booster_applications
  for insert to authenticated with check (
    user_id = auth.uid() and status = 'pending' and admin_notes is null
  );

-- Approved boosters see only the operational projection of unassigned jobs,
-- never payment identifiers, customer identity, credentials or private notes.
drop policy if exists "orders_booster_available_read" on public.orders;
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster();

revoke all on public.available_boost_orders from anon;
grant select on public.available_boost_orders to authenticated;

-- RLS protects rows, not columns. Keep internal notes and encrypted ciphertext
-- unreachable to booster JWTs while preserving the admin management screen.
revoke select on public.duo_accounts from authenticated;
grant select (id, label, current_rank, is_active, created_at) on public.duo_accounts to authenticated;

create or replace view public.admin_duo_accounts
  with (security_barrier = true) as
select id, game_id, label, current_rank, notes, is_active, created_by, created_at, updated_at
from public.duo_accounts
where public.is_admin();
revoke all on public.admin_duo_accounts from anon;
grant select on public.admin_duo_accounts to authenticated;

-- Serialize slot checks for a booster across different orders. Row-locking only
-- the order is insufficient when two separate jobs are accepted concurrently.
create or replace function public.accept_boost_order(
  p_order_id uuid,
  p_booster_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, boost_mode into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'assigned', assigned_booster_id = p_booster_user_id, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;

-- Username normalization/validation belongs server-side, not only in the form.
create or replace function public.update_my_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_username text := btrim(p_username);
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'unauthorized'); end if;
  if char_length(v_username) < 3 or char_length(v_username) > 30
     or v_username !~ '^[A-Za-z0-9_]+$' then
    return jsonb_build_object('success', false, 'error', 'invalid_username');
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_username) and id <> auth.uid()) then
    return jsonb_build_object('success', false, 'error', 'username_taken');
  end if;
  update public.profiles set username = v_username, updated_at = now() where id = auth.uid();
  return jsonb_build_object('success', true);
end;
$$;

-- Database-backed fixed-window limiter used by authenticated Edge Functions.
create table if not exists public.edge_rate_limits (
  scope text not null,
  subject text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope, subject)
);
alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from anon, authenticated;

create or replace function public.consume_edge_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.edge_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_scope !~ '^[a-z0-9_-]{1,64}$' or char_length(p_subject) > 128
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit configuration';
  end if;

  insert into public.edge_rate_limits(scope, subject, window_started_at, request_count)
  values (p_scope, p_subject, v_now, 1)
  on conflict (scope, subject) do update set
    window_started_at = case
      when edge_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else edge_rate_limits.window_started_at
    end,
    request_count = case
      when edge_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else edge_rate_limits.request_count + 1
    end
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.request_count <= p_limit,
    'retry_after', greatest(1, ceil(extract(epoch from (
      v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now
    )))::integer)
  );
end;
$$;
revoke all on function public.consume_edge_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer) to service_role;

-- One request key maps a client attempt to one order, even across retries.
alter table public.orders add column if not exists idempotency_key uuid;
create unique index if not exists orders_customer_idempotency_idx
  on public.orders(customer_id, idempotency_key) where idempotency_key is not null;

-- Atomically attach the provider payment and its local record.
create or replace function public.record_pix_payment(
  p_order_id uuid,
  p_customer_id uuid,
  p_mp_payment_id text,
  p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_existing text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> p_customer_id then raise exception 'order mismatch'; end if;
  if round(v_order.total_price, 2) <> round(p_amount, 2) or p_amount <= 0 then raise exception 'amount mismatch'; end if;
  if v_order.mp_payment_id is not null and v_order.mp_payment_id <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  select mp_payment_id into v_existing from public.payments where order_id = p_order_id for update;
  if found and v_existing <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  update public.orders set mp_payment_id = p_mp_payment_id, updated_at = now() where id = p_order_id;
  insert into public.payments(order_id, customer_id, mp_payment_id, amount, currency, status, metadata)
  values (p_order_id, p_customer_id, p_mp_payment_id, round(p_amount, 2), 'brl', 'pending',
          jsonb_build_object('provider', 'mercadopago', 'mp_payment_id', p_mp_payment_id))
  on conflict (order_id) do update set updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.record_pix_payment(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.record_pix_payment(uuid, uuid, text, numeric) to service_role;

-- Apply provider status, order transition, history and notification in one DB transaction.
create or replace function public.process_mp_payment_event(
  p_order_id uuid,
  p_mp_payment_id text,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_event_id text,
  p_refund_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_payment_status public.payment_status;
  v_to_status public.order_status;
begin
  if p_provider_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back') then
    return jsonb_build_object('success', true, 'ignored', true);
  end if;

  select * into v_order from public.orders
  where id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_order_mismatch'); end if;

  select * into v_payment from public.payments
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_not_found'); end if;

  if lower(p_currency) <> 'brl' or round(p_amount, 2) <> round(v_order.total_price, 2) then
    return jsonb_build_object('success', false, 'error', 'payment_reconciliation_failed');
  end if;

  v_payment_status := case
    when p_provider_status = 'approved' then 'paid'::public.payment_status
    when p_provider_status in ('rejected','cancelled') then 'failed'::public.payment_status
    when p_provider_status = 'refunded' then 'refunded'::public.payment_status
    when p_provider_status = 'charged_back' then 'disputed'::public.payment_status
    else 'pending'::public.payment_status
  end;

  update public.payments set
    status = v_payment_status,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_order.status = 'awaiting_payment' then
    update public.orders set status = 'awaiting_assignment', payment_status = 'paid', updated_at = now()
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'awaiting_payment', 'awaiting_assignment', v_order.customer_id,
            'Pagamento PIX confirmado via Mercado Pago');
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'payment_confirmed', 'PIX confirmado!',
            'Seu pedido foi pago e está na fila de boosters.', jsonb_build_object('order_id', p_order_id));
  elsif p_provider_status in ('refunded','charged_back')
        and v_order.status not in ('refunded','disputed') then
    v_to_status := case when p_provider_status = 'refunded' then 'refunded'::public.order_status else 'disputed'::public.order_status end;
    update public.orders set status = v_to_status, payment_status = v_payment_status, updated_at = now()
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, v_order.customer_id,
            case when p_provider_status = 'refunded' then 'Pagamento reembolsado via Mercado Pago' else 'Chargeback recebido via Mercado Pago' end);
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_status_changed',
            case when p_provider_status = 'refunded' then 'Pedido reembolsado' else 'Pagamento contestado' end,
            case when p_provider_status = 'refunded' then 'Seu pedido foi reembolsado.' else 'Seu pagamento está em disputa.' end,
            jsonb_build_object('order_id', p_order_id));
    if p_provider_status = 'refunded' then
      insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status)
      values (v_payment.id, p_order_id, coalesce(p_refund_id, p_mp_payment_id || '-refund'),
              v_order.total_price, 'Reembolso processado pelo Mercado Pago', v_order.customer_id, 'completed')
      on conflict (mp_refund_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text) to service_role;
