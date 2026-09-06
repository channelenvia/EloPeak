-- Bug (achado em checkup de código): admin_create_manual_refund (migration
-- 20260903150500) limitava o reembolso a orders.total_price, mas total_price
-- é MUTADO por apply_order_drop (migration 20260903150800) a cada drop --
-- ele pode tanto cair (fração já entregue ao cliente é descontada) quanto
-- SUBIR (ramo negativo de elo_boost/win_boost: cliente ficou pra trás, o
-- penalty do booster é somado a total_price pra cobrir a recuperação).
-- Depois de 2 drops nesse ramo negativo, o pedido cai em 'under_review' com
-- total_price já bem acima do que o cliente realmente pagou -- confirmado em
-- produção: pedido d18f56a1-568b-45a7-8c13-ae36c0117658 tem total_price =
-- 11.34 mas o pagamento (public.payments.amount) foi de apenas 3.97. Com a
-- função antiga, um admin poderia reembolsar até 11.34 num pedido que só
-- recebeu 3.97 -- perda direta de dinheiro.
--
-- Fix: o teto do reembolso passa a ser o total efetivamente pago
-- (soma de public.payments.amount para o pedido, excluindo pagamentos que
-- nunca foram capturados -- 'pending'/'failed') menos os reembolsos já
-- emitidos (continua somando public.refunds, que já cobre tanto reembolso
-- manual quanto o automático via webhook do Mercado Pago -- ver
-- process_mp_payment_event, migration 20260903140100).

create or replace function public.admin_create_manual_refund(
  p_order_id uuid,
  p_reason   text,
  p_amount   numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_total_paid     numeric;
  v_already_refunded numeric;
  v_remaining      numeric;
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

  insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
  select p.id, p_order_id, 'manual-' || gen_random_uuid()::text, p_amount, v_reason, auth.uid(), 'succeeded', true
  from public.payments p where p.order_id = p_order_id order by p.created_at desc limit 1
  returning id into v_refund_id;

  if v_refund_id is null then
    return jsonb_build_object('success', false, 'error', 'payment_not_found');
  end if;

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
$$;

revoke all on function public.admin_create_manual_refund(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_create_manual_refund(uuid, text, numeric) to authenticated;
