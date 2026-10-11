-- M-16: lock/unlock do chat emite evento realtime (mesma assinatura, CREATE OR REPLACE).
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.admin_set_order_chat_lock(p_order_id uuid, p_locked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_set_order_chat_lock', 30, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas tentativas. Aguarde um minuto.');
  end if;
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('success', false, 'code', 'forbidden', 'message', 'Apenas administradores podem controlar o chat.');
  end if;

  update public.orders
  set chat_locked = p_locked,
      chat_locked_by = case when p_locked then v_user_id else null end,
      chat_locked_at = case when p_locked then now() else null end,
      updated_at = now()
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  -- M-16: order_status_events e a tabela publicada no realtime; um tick faz o chat reler can_send na hora.
  insert into public.order_status_events(order_id, status)
  select id, status from public.orders where id = p_order_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (
    v_user_id,
    'admin'::public.user_role,
    case when p_locked then 'order_chat_locked' else 'order_chat_unlocked' end,
    'order',
    p_order_id,
    jsonb_build_object('chat_locked', p_locked)
  );

  return jsonb_build_object('success', true, 'chat_locked', p_locked);
end;
$function$
;
