-- Companheira de 20260911020000 (admin_flag_order_under_review agora aceita
-- 'drop_requested' como status ativo travável em análise).
--
-- Antes dessa mudança, nada além do próprio resolve_drop_request conseguia
-- tirar um pedido de 'drop_requested' -- admin_reassign_booster nem
-- apply_order_drop direto aceitam esse status como origem. Por isso o branch
-- de REJEIÇÃO aqui nunca reconferiu o status atual do pedido antes de
-- restaurá-lo: bastava order_drop_requests.status ainda ser 'pending'.
--
-- Agora que um admin pode colocar esse pedido em under_review enquanto o
-- drop_request continua 'pending' na tabela separada, um reject concorrente
-- sobrescreveria orders.status direto pra v_restore_status, saltando por
-- cima do under_review sem passar por _release_pending_review_order (perde
-- under_review_from_status/started_at, e o pedido "sai" da análise sem
-- ninguém ter liberado). O branch de aprovação já era protegido (
-- apply_order_drop confere v_order.status = p_from_status internamente e
-- falha se não bater); esta migration adiciona a mesma trava explícita aqui
-- pros dois branches, com o mesmo lock (for update) usado no resto da base
-- pra serializar contra admin_flag_order_under_review.
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null,
  p_coaching_completion_pct numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
  v_order_status   public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select status into v_order_status from public.orders where id = v_req.order_id for update;
  if v_order_status is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order_status <> 'drop_requested' then
    return jsonb_build_object('success', false, 'error', 'order_not_drop_requested');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    v_result := public.apply_order_drop(
      v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role,
      p_coaching_completion_pct
    );

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_amount = coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
           resolved_at = now()
    where  id = p_request_id;
  else
    v_restore_status := coalesce(v_req.status_at_request, 'in_progress');

    update public.orders set status = v_restore_status, updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', v_restore_status, auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));

    update public.order_drop_requests
    set    status      = 'rejected',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           resolved_at = now()
    where  id = p_request_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;
