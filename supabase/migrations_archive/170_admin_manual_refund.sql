-- Reembolso manual: o admin registra um reembolso que ele mesmo processa
-- fora do sistema (PIX manual direto pro cliente, combinado por DM/ticket) --
-- diferente do fluxo automático via webhook (process_mp_payment_event), que
-- sempre grava payment_id/mp_refund_id reais do Mercado Pago. Esses dois
-- campos ficam opcionais só pra esse caso; is_manual marca a origem pra
-- distinguir reembolsos manuais dos processados de fato pelo Mercado Pago
-- na listagem (aba Reembolsos do admin).
alter table public.refunds alter column payment_id drop not null;
alter table public.refunds alter column mp_refund_id drop not null;
alter table public.refunds add column if not exists is_manual boolean not null default false;

-- Mesmo padrão de admin_override_order_status (migration 131) e
-- admin_drop_order (071): security definer, checa is_admin(), grava
-- order_status_history + audit_logs. Não mexe em ledger/comissão do
-- booster nem chama a API do Mercado Pago -- o estorno de fato acontece
-- manualmente entre admin e cliente, fora do sistema.
create or replace function public.admin_create_manual_refund(
  p_order_id uuid,
  p_reason   text,
  p_amount   numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order     record;
  v_actor     record;
  v_refund_id uuid;
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

  select id, status into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

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
$$;

grant execute on function public.admin_create_manual_refund(uuid, text, numeric) to authenticated;
