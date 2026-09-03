-- cancel-pending-order previously ran 3 unlocked, separate writes from Deno
-- (update payments -> update orders -> insert history). The payments update had
-- no status guard, so a webhook that approved the payment in the same window
-- as a customer-initiated cancel could have its 'paid' row silently stomped to
-- 'failed' while orders stayed correctly untouched (guarded by
-- status = 'awaiting_payment') -- leaving payments/orders inconsistent and a
-- false 'awaiting_payment -> canceled' entry in order_status_history.
-- This mirrors process_mp_payment_event's pattern: one transaction, row locks
-- via `for update` on both orders and payments before mutating either.
create or replace function public.cancel_pending_order_payment(
  p_order_id uuid,
  p_customer_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders
  where id = p_order_id and customer_id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'awaiting_payment' then
    return jsonb_build_object('success', false, 'error', 'order_not_awaiting_payment');
  end if;

  -- Lock the payment row too so a concurrent webhook can't flip it under us
  -- between this check and the updates below.
  perform 1 from public.payments where order_id = p_order_id for update;

  update public.payments
  set status = 'failed', updated_at = now()
  where order_id = p_order_id and customer_id = p_customer_id and status = 'pending';

  update public.orders
  set status = 'canceled', updated_at = now()
  where id = p_order_id and customer_id = p_customer_id and status = 'awaiting_payment';

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_payment', 'canceled', p_customer_id,
          'Cancelado pelo cliente antes da confirmação do pagamento');

  return jsonb_build_object('success', true, 'order_id', p_order_id, 'canceled', true);
end;
$$;
revoke all on function public.cancel_pending_order_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_pending_order_payment(uuid, uuid) to service_role;
