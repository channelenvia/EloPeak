-- Bug (LOW): admin_override_order_status não valida tamanho/não-vazio de
-- p_reason, diferente das RPCs irmãs de admin (admin_cancel_*/admin_assign_*)
-- que exigem 10-500 caracteres.
--
-- Fix: reusar a mesma checagem de trim+length usada pelas outras RPCs de
-- admin (ex. admin_drop_order/admin_reassign_booster).
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
