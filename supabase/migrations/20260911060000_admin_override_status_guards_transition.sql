-- Bug (achado em auditoria): admin_override_order_status trava a linha
-- (for update) mas nunca reconfere v_order.status antes de escrever
-- p_new_status -- diferente de toda outra RPC de ciclo de vida de pedido
-- (admin_drop_order, admin_reassign_booster, admin_flag_order_under_review,
-- admin_(cancel|assign)_pending_review_order, resolve_drop_request), que
-- validam o status atual dentro da própria transação travada.
--
-- Fix mínimo, sem mexer no propósito da RPC (é de propósito um "escape
-- hatch" flexível pro admin corrigir estado incomum -- por isso as 3
-- exclusões de status continuam intactas, redirecionando pro fluxo de
-- drop): rejeita só a transição sem efeito (p_new_status igual ao status
-- atual), que só gerava ruído em order_status_history/audit_logs sem mudar
-- nada de fato. Resto idêntico à versão vigente
-- (migrations_archive/20260906110000).
create or replace function public.admin_override_order_status(p_order_id uuid, p_new_status text, p_reason text default 'Admin override'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_actor record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  if p_new_status in ('awaiting_assignment', 'pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  if v_order.status::text = p_new_status then
    return jsonb_build_object('success', false, 'error', 'no_status_change');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.orders set status = p_new_status::public.order_status, updated_at = now()
  where  id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_new_status::public.order_status, auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
          jsonb_build_object('from', v_order.status, 'to', p_new_status));

  return jsonb_build_object('success', true);
end;
$function$;
