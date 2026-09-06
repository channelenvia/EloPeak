-- Bug (HIGH, resto pendente de 20260906000000): admin_create_manual_refund
-- já usa payments.amount - refunds.amount como teto (migration anterior),
-- mas nunca atualiza payments.refunded_amount depois de inserir a linha de
-- reembolso. Essa coluna é lida direto pela UI de admin
-- (src/features/admin/pages/Refunds.tsx, campo "Já reembolsado") a partir de
-- um select('*') cru em payments -- sem esse update, todo reembolso manual
-- aparece como R$ 0 já reembolsado pro admin, mesmo o teto de reembolso
-- (calculado à parte via a soma de refunds) estando correto.
--
-- Fix: travar a linha de payments escolhida e incrementar refunded_amount
-- por p_amount na mesma transação do insert em refunds.
create or replace function public.admin_create_manual_refund(p_order_id uuid, p_reason text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_total_paid     numeric;
  v_already_refunded numeric;
  v_remaining      numeric;
  v_payment_id     uuid;
  v_refund_id      uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  select id, total_price, customer_id, payment_status
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.payments where order_id = p_order_id and status not in ('pending', 'failed');

  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds where order_id = p_order_id;

  v_remaining := v_total_paid - v_already_refunded;

  if v_remaining <= 0 then
    return jsonb_build_object('success', false, 'error', 'already_refunded');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  select id into v_payment_id
  from public.payments where order_id = p_order_id order by created_at desc limit 1
  for update;

  if v_payment_id is null then
    return jsonb_build_object('success', false, 'error', 'payment_not_found');
  end if;

  insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
  values (v_payment_id, p_order_id, 'manual-' || gen_random_uuid()::text, p_amount, v_reason, auth.uid(), 'succeeded', true)
  returning id into v_refund_id;

  update public.payments
  set refunded_amount = coalesce(refunded_amount, 0) + p_amount, updated_at = now()
  where id = v_payment_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount, 'refund_id', v_refund_id));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Reembolso processado',
      'R$ ' || p_amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id, 'amount', p_amount)
    );
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund_id, 'remaining', v_remaining - p_amount);
end;
$function$;
