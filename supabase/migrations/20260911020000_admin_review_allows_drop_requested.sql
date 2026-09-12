-- Gap (achado em auditoria, confirmado como bug pelo produto): admin_flag_
-- order_under_review (migration 20260908050000) não incluía 'drop_requested'
-- no allowlist de status "ativos" travável em análise -- um pedido com
-- solicitação de drop pendente não podia ser colocado em under_review pra
-- investigação antes de decidir aprovar/rejeitar o drop (só pending_review/
-- assigned/in_progress/paused/awaiting_customer eram aceitos).
--
-- Fix: adiciona 'drop_requested' ao allowlist. Nenhuma outra mudança --
-- drop_requested sempre tem assigned_booster_id preenchido (a entrada nesse
-- status não desatribui o booster, só marca a solicitação pendente), então
-- cai naturalmente no branch "booster preservado" já existente, e
-- _release_pending_review_order já restaura genericamente via
-- under_review_from_status (sem exigir mudança lá). resolve_drop_request
-- continua exigindo status = 'drop_requested' -- fica bloqueado enquanto o
-- pedido estiver em under_review, e volta a ficar disponível quando a
-- análise for liberada, mesma trava que já vale para assigned/in_progress.
create or replace function public.admin_flag_order_under_review(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_from_status public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_from_status := v_order.status;

  if v_order.assigned_booster_id is not null then
    update public.orders
    set status                    = 'under_review',
        under_review_from_status  = v_from_status,
        under_review_started_at   = now(),
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido entrou em análise manual da nossa equipe -- fica travado (sem novas partidas contabilizadas) até liberarmos de novo. Entraremos em contato pelo chat do pedido se precisarmos de mais informações.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido seu foi colocado em análise pela equipe -- sync de partidas e acesso à conta ficam pausados até liberarmos de novo. Você continua responsável por ele.',
      jsonb_build_object('order_id', p_order_id)
    );

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'from_status', v_from_status, 'booster_preserved', true));

    return jsonb_build_object('success', true);
  end if;

  update public.orders
  set status               = 'under_review',
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido em análise',
      'Seu pedido entrou em análise manual pela nossa equipe. Se precisarmos de mais informações, falaremos com você pelo chat do pedido.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'from_status', v_from_status));

  return jsonb_build_object('success', true);
end;
$$;
