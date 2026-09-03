-- Drift confirmado na auditoria "pente fino": admin_create_manual_refund existe
-- e funciona ao vivo no banco (usada por src/api/orders/mutations.ts ->
-- adminCreateManualRefund), mas nenhuma migration rastreada neste repo a
-- definia -- um `db reset`/disaster recovery apagaria o reembolso manual do
-- admin. Definição recuperada via
-- `select pg_get_functiondef('admin_create_manual_refund'::regproc);` no SQL
-- editor do Supabase Studio e reproduzida aqui exatamente como está em
-- produção (mesma assinatura, sem alteração de comportamento).

create or replace function public.admin_create_manual_refund(p_order_id uuid, p_reason text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order          record;
  v_actor          record;
  v_refund_id      uuid;
  v_already_refunded numeric;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_reason is null or length(trim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  select id, status, total_price into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  if v_order.status = 'refunded' then
    return jsonb_build_object('success', false, 'error', 'already_refunded');
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds where order_id = p_order_id;

  if p_amount > (v_order.total_price - v_already_refunded) then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  insert into public.refunds (order_id, payment_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
  values (p_order_id, null, null, p_amount, trim(p_reason), auth.uid(), 'succeeded', true)
  returning id into v_refund_id;

  update public.orders set status = 'refunded'::public.order_status, updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'refunded'::public.order_status, auth.uid(), 'Reembolso manual: ' || trim(p_reason));

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.manual_refund', 'order', p_order_id::text,
          jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount, 'from_status', v_order.status));

  return jsonb_build_object('success', true, 'refund_id', v_refund_id);
end;
$function$;

revoke all on function public.admin_create_manual_refund(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_create_manual_refund(uuid, text, numeric) to authenticated;
