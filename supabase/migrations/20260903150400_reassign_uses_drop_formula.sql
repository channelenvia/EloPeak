-- admin_reassign_booster: dois ramos distintos, igual à versão vigente
-- (migration 20260902160000). Atribuição NOVA (pedido em awaiting_assignment,
-- sem booster ainda) não passa por apply_order_drop -- não existe "quem
-- dropar" nem progresso a liquidar, então continua um UPDATE direto igual
-- sempre foi. Só a REATRIBUIÇÃO de um booster já ativo passa a reusar
-- apply_order_drop por inteiro (mesma fórmula de valor por progresso, mesmo
-- limite de 2 drops -- reatribuição consome o mesmo orçamento de "trocas de
-- mão" que um drop normal) em vez de só mover assigned_booster_id sem tocar
-- em preço/progresso. p_requester_role = 'admin': cai no mesmo ramo de
-- 'customer' na fórmula negativa (desconta só a comissão do booster, nunca
-- o valor cheio -- essa penalidade é reservada pra quando o PRÓPRIO booster
-- escolhe abandonar).
--
-- Se o pedido atingir o limite de 2 drops nesta reatribuição, apply_order_
-- drop cancela e joga em 'under_review' -- a atribuição ao novo booster não
-- acontece (não existe "novo booster" nesse caso, o pedido saiu do fluxo
-- normal).
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
  v_result             jsonb;
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

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  if not v_is_new_assignment then
    v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role);

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;
  end if;

  update public.orders
  set assigned_booster_id = p_target_booster_id,
      status = 'assigned',
      duo_own_riot_id = null,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_assignment', 'assigned', auth.uid(),
          case when v_is_new_assignment then 'Booster atribuído manualmente pelo admin: ' || v_reason
               else 'Reatribuído pelo admin: ' || v_reason end);

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_target_booster_id);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin',
    case when v_is_new_assignment then 'Um pedido foi atribuído a você' else 'Um pedido foi reatribuído a você' end,
    'Um administrador atribuiu este pedido a você. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

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
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id,
                              'new_booster_id', p_target_booster_id, 'new_assignment', v_is_new_assignment,
                              'drop_result', v_result));

  return jsonb_build_object('success', true, 'drop_result', v_result);
end;
$$;
