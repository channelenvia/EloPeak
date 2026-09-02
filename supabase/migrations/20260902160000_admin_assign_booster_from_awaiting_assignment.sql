-- admin_reassign_booster só aceitava pedidos que JÁ tinham um booster ativo
-- (assigned_booster_id not null) -- pedidos 'awaiting_assignment' (no pool,
-- ainda sem booster, aguardando alguém aceitar) caíam no early return
-- 'order_not_assigned', então o admin não conseguia atribuir manualmente um
-- booster a esses pedidos direto do menu de ações.
--
-- Fix: a função agora também aceita pedidos 'awaiting_assignment' sem
-- assigned_booster_id -- nesse caso é uma ATRIBUIÇÃO (não reatribuição): não
-- existe booster antigo pra notificar/fechar assignment, e o pedido sai de
-- 'awaiting_assignment' pra 'assigned' (mesmo status que accept_boost_order
-- grava em order_status_history ao ser aceito organicamente pelo booster --
-- ver migration 20260829030000). available_boost_orders já filtra
-- assigned_booster_id is null, então o pedido some da aba Jobs de todo mundo
-- assim que assigned_booster_id deixa de ser null, e passa a aparecer só na
-- aba Pedidos do booster selecionado (que já lista status='assigned', ver
-- BOOSTER_ACTIVE_STATUSES em src/api/orders/types.ts).
create or replace function public.admin_reassign_booster(
  p_order_id uuid,
  p_target_booster_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order              record;
  v_reason             text := trim(p_reason);
  v_target             record;
  v_is_new_assignment  boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, last_match_synced_at, customer_id
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  v_is_new_assignment := v_order.assigned_booster_id is null;

  if v_is_new_assignment then
    if v_order.status <> 'awaiting_assignment' then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
  else
    if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
    if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
      return jsonb_build_object('success', false, 'error', 'sync_required_before_reassign');
    end if;
    if v_order.assigned_booster_id = p_target_booster_id then
      return jsonb_build_object('success', false, 'error', 'already_assigned_to_target');
    end if;
  end if;

  select user_id, display_name, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set assigned_booster_id = p_target_booster_id,
      duo_own_riot_id = null,
      status = case when v_is_new_assignment then 'assigned' else status end,
      updated_at = now()
  where id = p_order_id;

  if v_is_new_assignment then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'awaiting_assignment', 'assigned', auth.uid(), 'Booster atribuído manualmente pelo admin: ' || v_reason);
  else
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_reassigned_by_admin', 'Você foi removido de um pedido',
      'Um administrador reatribuiu este pedido para outro booster. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_target_booster_id);

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin', 'Um pedido foi atribuído a você',
    'Um administrador atribuiu este pedido a você. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  -- Cliente só é avisado numa TROCA de booster (a atribuição inicial não tem
  -- "antes" pra comparar, e accept_boost_order também não notifica o cliente
  -- quando um booster aceita organicamente -- mesma consistência aqui).
  if not v_is_new_assignment and v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Booster do seu pedido foi trocado',
      'Um administrador reatribuiu seu pedido para outro booster.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id, 'new_booster_id', p_target_booster_id, 'new_assignment', v_is_new_assignment));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_reassign_booster(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reassign_booster(uuid, uuid, text) to authenticated;
