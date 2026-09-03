-- Pedido dropado (via solicitação do booster aprovada pelo admin, OU drop
-- direto do admin) deixa de ser cancelado -- volta pra fila de boosters como
-- se fosse um pedido novo (status 'awaiting_assignment', sem booster
-- atribuído, sem preferência/exclusividade de booster). O trigger já
-- existente trg_notify_boosters_order_available (042/051) cuida sozinho de
-- avisar os boosters via Realtime assim que o status muda pra
-- 'awaiting_assignment' -- nenhuma mudança de frontend necessária pro pedido
-- reaparecer na aba de jobs.
--
-- Três reforços que vêm junto com a reabertura:
--   1) Conta duo reservada (se houver) é liberada explicitamente -- o
--      trigger trg_release_duo_account_on_order_end (056) só libera em
--      status completed/canceled/refunded, nunca em awaiting_assignment.
--   2) O booster que dropou não pode pegar o mesmo pedido de volta --
--      reaproveita order_drop_requests.status = 'approved' (ambos os
--      caminhos já inserem uma linha lá) como lista de exclusão, sem tabela
--      nova. Reforçado tanto na view (o que aparece na lista) quanto na RPC
--      de aceite (o que é aceito de fato).
--   3) Cliente é notificado que o pedido voltou pra fila; no drop direto do
--      admin, o booster removido também é notificado (a solicitação de drop
--      aprovada já notifica o booster sobre a penalidade quando > 0, mas o
--      drop direto do admin nunca notificava ninguém).

-- ─── resolve_drop_request: aprovar reabre em vez de cancelar ────────────────
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve    boolean,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req   record;
  v_order record;
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.penalty_amount, r.status
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, customer_id into v_order from public.orders where id = v_req.order_id for update;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    update public.orders set
      status = 'awaiting_assignment',
      assigned_booster_id = null,
      preferred_booster_id = null,
      exclusive_until = null,
      used_exclusive_slot = false,
      updated_at = now()
    where id = v_req.order_id;

    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = v_req.order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'awaiting_assignment', auth.uid(), 'Drop request approved; order reopened for reassignment');

    if v_req.penalty_amount > 0 then
      update public.booster_profiles
      set    total_earnings = greatest(0, total_earnings - v_req.penalty_amount)
      where  user_id = v_req.booster_id;

      insert into public.booster_ledger_entries(
        booster_id, order_id, entry_type, amount, description, actor_id, actor_role
      ) values (
        v_req.booster_id, v_req.order_id, 'drop_penalty', -v_req.penalty_amount,
        'Penalidade por abandono do pedido ' || v_req.order_id::text,
        auth.uid(), 'admin'::public.user_role
      );

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_req.booster_id,
        'drop_penalty_applied',
        'Penalidade de abandono aplicada',
        'Seu pedido de drop foi aprovado. Uma penalidade de R$ ' || v_req.penalty_amount::text || ' foi descontada do seu saldo.',
        jsonb_build_object('order_id', v_req.order_id, 'amount', v_req.penalty_amount)
      );
    end if;

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id,
        'order_reassigned',
        'Pedido de volta à fila',
        'Seu booster deixou o pedido. Ele já está disponível para outro booster assumir.',
        jsonb_build_object('order_id', v_req.order_id)
      );
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'penalty_amount', v_req.penalty_amount));
  else
    update public.orders set status = 'in_progress', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'in_progress', auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));
  end if;

  update public.order_drop_requests
  set    status      = case when p_approve then 'approved' else 'rejected' end,
         admin_id    = auth.uid(),
         admin_note  = p_admin_note,
         resolved_at = now()
  where  id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.resolve_drop_request(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_drop_request(uuid, boolean, text) to authenticated;

-- ─── admin_drop_order: reabre em vez de cancelar, notifica cliente e booster ─
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

  select id, status, assigned_booster_id, customer_id, wins_played, losses_played
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

  update public.orders set
    status = 'awaiting_assignment',
    assigned_booster_id = null,
    preferred_booster_id = null,
    exclusive_until = null,
    used_exclusive_slot = false,
    updated_at = now()
  where id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'awaiting_assignment', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id,
    'order_dropped_by_admin',
    'Você foi removido de um pedido',
    'Um administrador retirou você do pedido. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'order_reassigned',
      'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id));

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.admin_drop_order(uuid, text) to authenticated;

-- ─── available_boost_orders: esconde pedidos que este booster já dropou ─────
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;

-- ─── accept_boost_order: bloqueia server-side quem já dropou este pedido ────
create or replace function public.accept_boost_order(
  p_order_id uuid,
  p_booster_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = p_order_id and dr.booster_id = p_booster_user_id and dr.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'previously_dropped_by_you');
  end if;
  if public.order_requires_access_token(v_order.service_type, v_order.boost_mode)
     and not v_order.credentials_set then
    return jsonb_build_object('success', false, 'error', 'missing_access_token');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.exclusive_until is not null
     and v_order.exclusive_until > now()
     and v_order.preferred_booster_id <> p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null
    and v_order.exclusive_until > now();

  if v_is_exclusive then
    if public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'assigned', assigned_booster_id = p_booster_user_id, used_exclusive_slot = true, updated_at = now()
    where id = p_order_id;

    return jsonb_build_object('success', true, 'details', jsonb_build_object('used_exclusive_slot', true));
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'assigned', assigned_booster_id = p_booster_user_id, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;
