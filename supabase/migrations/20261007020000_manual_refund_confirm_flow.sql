-- Reembolso manual em duas etapas, igual para PIX e cartão:
--   1) "Marcar pra reembolsar": cria o item na tela "A reembolsar" com status
--      'pending'. O pedido NÃO muda de status e o cliente NÃO é avisado.
--   2) O admin devolve o dinheiro por fora (PIX manual ou estorno do cartão no
--      painel do Mercado Pago) e confirma no check: o item vira 'succeeded', o
--      pedido vira 'refunded' e o cliente é notificado. O item continua na
--      lista, agora como concluído.
-- Antes, o passo 1 já marcava o pedido como reembolsado sem o dinheiro ter
-- saído. Também permite desfazer a marcação (status 'failed') enquanto
-- pendente, para um engano não travar o pedido em 'already_refunded'.

create or replace function public.admin_create_manual_refund(p_order_id uuid, p_reason text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order            record;
  v_reason           text := trim(p_reason);
  v_total_paid       numeric;
  v_already_refunded numeric;
  v_remaining        numeric;
  v_payment_id       uuid;
  v_refund_id        uuid;
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

  -- Marcações desfeitas/falhas não seguram o valor do pedido.
  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds where order_id = p_order_id and status <> 'failed';

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
  values (v_payment_id, p_order_id, 'manual-' || gen_random_uuid()::text, p_amount, v_reason, auth.uid(), 'pending', true)
  returning id into v_refund_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_marked', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount, 'refund_id', v_refund_id));

  return jsonb_build_object('success', true, 'refund_id', v_refund_id, 'remaining', v_remaining - p_amount);
end;
$function$;

create or replace function public.admin_confirm_manual_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_refund public.refunds%rowtype;
  v_order  record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  -- Mesma ordem de lock do webhook e da criação: pedido primeiro, depois o reembolso.
  select id, status, customer_id into v_order from public.orders where id = v_refund.order_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;

  update public.refunds set status = 'succeeded' where id = v_refund.id;

  update public.payments
  set refunded_amount = coalesce(refunded_amount, 0) + v_refund.amount, updated_at = now()
  where id = v_refund.payment_id;

  -- O webhook do Mercado Pago pode ter reembolsado o pedido no meio tempo.
  if v_order.status <> 'refunded' then
    update public.orders set status = 'refunded'::public.order_status, updated_at = now()
    where id = v_order.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_order.id, v_order.status, 'refunded'::public.order_status, auth.uid(),
            'Reembolso manual confirmado: ' || v_refund.reason);
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_confirmed', 'order', v_order.id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Reembolso processado',
      'R$ ' || v_refund.amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_refund.reason,
      jsonb_build_object('order_id', v_order.id, 'amount', v_refund.amount)
    );
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$;

create or replace function public.admin_cancel_manual_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_refund public.refunds%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  perform 1 from public.orders where id = v_refund.order_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;

  update public.refunds set status = 'failed' where id = v_refund.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_canceled', 'order', v_refund.order_id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$;

revoke all on function public.admin_confirm_manual_refund(uuid) from public, anon;
revoke all on function public.admin_cancel_manual_refund(uuid) from public, anon;
grant execute on function public.admin_confirm_manual_refund(uuid) to authenticated;
grant execute on function public.admin_cancel_manual_refund(uuid) to authenticated;

-- Reembolso real vindo do Mercado Pago (cartão estornado no painel) enquanto há
-- marcação manual pendente: o dinheiro de fato saiu, então a marcação vira
-- concluída e a linha do provedor só grava o que a manual não cobriu.
create or replace function public.dedupe_provider_refund_after_manual()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual numeric;
begin
  if coalesce(new.is_manual, false) then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_manual
  from public.refunds
  where order_id = new.order_id and is_manual and status <> 'failed';

  if v_manual <= 0 then
    return new;
  end if;

  update public.refunds set status = 'succeeded'
  where order_id = new.order_id and is_manual and status = 'pending';

  if v_manual >= new.amount then
    return null;
  end if;

  new.amount := new.amount - v_manual;
  return new;
end;
$$;
