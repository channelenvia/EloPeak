-- ─────────────────────────────────────────────────────────────────────────────
-- Direct-order-with-booster: a customer can start an order from a booster's
-- public profile. Once payment is confirmed, the order is visible ONLY to
-- that booster for 3 hours (exclusive_until), then falls back into the
-- shared available_boost_orders pool for any approved booster to claim.
--
-- No cron job is used for the fallback: available_boost_orders compares
-- exclusive_until against now() live on every read, so the window closes
-- itself with zero scheduled maintenance and no risk of a missed tick.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.orders add column if not exists preferred_booster_id uuid references public.profiles(id);
alter table public.orders add column if not exists exclusive_until timestamptz;

create index if not exists orders_preferred_booster_idx
  on public.orders(preferred_booster_id) where preferred_booster_id is not null;

-- Booster job pool: unassigned orders, minus any order still inside another
-- booster's exclusivity window. The preferred booster sees it (with the two
-- new columns exposed so the frontend can render the "exclusive" badge);
-- everyone else sees it only once exclusive_until has passed.
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  );

revoke all on public.available_boost_orders from anon;
grant select on public.available_boost_orders to authenticated;

-- Accepting a job is the only write path into "assigned" — enforce
-- exclusivity here too (defense in depth): the view already hides the row
-- from other boosters, but this RPC is callable directly with any order id.
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

  select id, status, boost_mode, preferred_booster_id, exclusive_until into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.exclusive_until is not null
     and v_order.exclusive_until > now()
     and v_order.preferred_booster_id <> p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
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

-- Payment confirmation: same transition as before, plus opening the
-- exclusivity window (only if the order was created with a preferred
-- booster) and notifying that booster.
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
    update public.orders set
      status = 'awaiting_assignment',
      payment_status = 'paid',
      exclusive_until = case when v_order.preferred_booster_id is not null then now() + interval '3 hours' else null end,
      updated_at = now()
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'awaiting_payment', 'awaiting_assignment', v_order.customer_id,
            'Pagamento PIX confirmado via Mercado Pago');
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'payment_confirmed', 'PIX confirmado!',
            'Seu pedido foi pago e está na fila de boosters.', jsonb_build_object('order_id', p_order_id));
    if v_order.preferred_booster_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (v_order.preferred_booster_id, 'exclusive_job', 'Pedido exclusivo para você!',
              'Um cliente pediu boost diretamente com você. Você tem 3 horas para aceitar antes que ele volte para a fila geral.',
              jsonb_build_object('order_id', p_order_id));
    end if;
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
