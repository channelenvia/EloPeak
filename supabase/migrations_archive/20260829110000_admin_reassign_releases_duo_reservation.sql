-- Achado pelo /code-review: admin_reassign_booster troca orders.assigned_
-- booster_id mas nunca libera a reserva em duo_accounts nem limpa
-- orders.duo_own_riot_id -- diferente de apply_order_drop/
-- cancel_order_after_drop_limit, que já fazem os dois. Resultado: num pedido
-- Duo Boost reatribuído pelo admin, a conta duo do booster ANTIGO
-- (reserved_by/reserved_order_id) fica presa pra sempre (nunca mais liberada
-- pro pool), e o booster NOVO herda orders.duo_own_riot_id do antigo --
-- DuoAccountSection pré-carrega esse valor como se já fosse a conta própria
-- do booster novo, quando na verdade é a riot id de outra pessoa.
--
-- Fix: libera a reserva em duo_accounts e zera duo_own_riot_id no reassign,
-- igual já acontece no drop -- o booster novo entra "limpo", como se
-- estivesse aceitando o pedido pela primeira vez do lado da conta duo.
create or replace function public.admin_reassign_booster(
  p_order_id uuid,
  p_target_booster_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_target record;
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
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_reassign');
  end if;
  if v_order.assigned_booster_id = p_target_booster_id then
    return jsonb_build_object('success', false, 'error', 'already_assigned_to_target');
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
  set assigned_booster_id = p_target_booster_id, duo_own_riot_id = null, updated_at = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_target_booster_id);

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_reassigned_by_admin', 'Você foi removido de um pedido',
    'Um administrador reatribuiu este pedido para outro booster. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin', 'Um pedido foi atribuído a você',
    'Um administrador atribuiu este pedido a você. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Booster do seu pedido foi trocado',
      'Um administrador reatribuiu seu pedido para outro booster.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id, 'new_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;
