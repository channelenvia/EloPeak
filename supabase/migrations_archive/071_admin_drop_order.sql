-- Permite que um admin derrube um pedido ativo diretamente (sem passar pela
-- fila de aprovação de order_drop_requests -- o admin JÁ é a autoridade que
-- aprovaria um drop pedido pelo booster, então não faz sentido um segundo
-- admin "aprovar" a própria ação do primeiro). Diferente do drop pedido pelo
-- booster (request_order_drop, migration 033), este NÃO aplica penalidade
-- sobre os ganhos do booster -- ele não escolheu abandonar o pedido, foi o
-- admin quem decidiu tirá-lo dali (ex.: reclamação do cliente, problema de
-- conduta). O registro ainda vai para order_drop_requests (já 'approved',
-- resolvido na hora) para manter o mesmo histórico/auditoria que os drops
-- via booster.
create or replace function public.admin_drop_order(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_request_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played,
    v_order.losses_played, 0, 0, 'approved', auth.uid(), 'Drop iniciado pelo admin', now()
  )
  returning id into v_request_id;

  update public.orders set status = 'canceled', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id));

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.admin_drop_order(uuid, text) to authenticated;
