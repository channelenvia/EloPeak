-- Revisão do fluxo de drop: booster SOLICITA (request_order_drop, precisa de
-- aprovação em /admin/drops), admin DROPA direto (admin_drop_order). Ambos
-- exigem motivo no frontend ("Motivo *", mín. 10 caracteres), mas só
-- admin_drop_order validava isso no backend (length(v_reason) between 10 and
-- 500, migration 071) -- request_order_drop nunca validava nada além de
-- reason NOT NULL (a constraint da coluna), então uma chamada direta à RPC
-- (bypassando o frontend) podia criar uma solicitação de drop com motivo
-- vazio ou de 1 caractere. Alinha as duas funções: mesmo trim + mesma faixa
-- de tamanho (10–500), mesmo erro 'invalid_reason' que o frontend/admin já
-- reconhecem.

create or replace function public.request_order_drop(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_penalty_pct integer;
  v_penalty_amt numeric(10,2);
  v_existing    uuid;
begin
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played, total_price
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'in_progress' then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_penalty_pct := case
    when v_order.wins_played = 0            then 0
    when v_order.wins_played between 1 and 2 then 10
    else 20
  end;
  v_penalty_amt := round(v_order.total_price * v_penalty_pct / 100.0, 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount)
  values (p_order_id, auth.uid(), v_reason,
    v_order.wins_played, v_order.losses_played, v_penalty_pct, v_penalty_amt);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), v_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_penalty_pct, 'penalty_amount', v_penalty_amt);
end;
$$;
