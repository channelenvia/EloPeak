-- Reatribuição de admin deixa de ser um flip direto de assigned_booster_id e
-- passa a reaproveitar o mesmo mecanismo de pedido exclusivo (preferred_booster_id
-- + exclusive_until de 12h): o pedido volta pra awaiting_assignment, some da
-- lista do booster antigo, e some do pool geral -- só o booster alvo o vê na
-- aba Jobs, com o mesmo prazo/DM/aviso no Discord de um pedido exclusivo
-- normal. Se não aceitar a tempo, cai no pool geral pra qualquer booster,
-- como um pedido comum (available_boost_orders já cobre isso via now()).
--
-- reassigned_by_admin distingue esse caso do exclusivo "de verdade" (pedido
-- direto comprado no perfil público) em dois pontos: accept_boost_order não
-- exige/consome o slot exclusivo bônus pra esse tipo de aceite, e
-- booster_active_slot_counts não conta o pedido aceito pro limite normal de
-- 3/4 -- reatribuições são ilimitadas pro booster, igual coaching.

alter table public.orders
  add column reassigned_by_admin boolean not null default false;

comment on column public.orders.reassigned_by_admin is
  'true enquanto o pedido está na janela de aceite criada por admin_reassign_booster -- accept_boost_order não cobra o slot exclusivo bônus nesse caso, e booster_active_slot_counts não conta o pedido pro limite normal (igual coaching). Fica true após aceito, como marca histórica; só afeta comportamento durante a janela exclusiva (preferred_booster_id = booster e exclusive_until > now()).';

-- available_boost_orders precisa expor a coluna nova pro front (badge
-- "Reatribuído" na aba Jobs) -- mesma definição de antes, só com a coluna
-- adicionada no select.
create or replace view public.available_boost_orders as
select
  id,
  service_id,
  game_id,
  status,
  queue_type,
  boost_mode,
  server,
  current_rank,
  target_rank,
  wins_purchased,
  sessions_purchased,
  win_package,
  extras,
  total_price,
  estimated_hours,
  wins_played,
  losses_played,
  current_pdl,
  pdl_bracket,
  avg_pdl_gain,
  avg_pdl_loss,
  pricing_version,
  created_at,
  updated_at,
  preferred_booster_id,
  exclusive_until,
  drop_count,
  rank_before_last_drop,
  last_dropped_at,
  service_type,
  clash_tier,
  clash_day,
  customer_lanes,
  reassigned_by_admin
from public.orders
where status = 'awaiting_assignment'::order_status
  and assigned_booster_id is null
  and is_approved_booster()
  and (not order_requires_access_token(service_type, boost_mode) or credentials_set = true)
  and case
    when service_type = 'coaching'::service_type then preferred_booster_id = auth.uid()
    else preferred_booster_id is null or exclusive_until is null or exclusive_until <= now() or preferred_booster_id = auth.uid()
  end
  and not exists (
    select 1 from order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'::text
  );

-- admin_reassign_booster: mesma validação de antes, mas em vez de já deixar
-- o pedido "assigned" pro novo booster, devolve ele pro pool (awaiting_assignment,
-- assigned_booster_id = null) reservado com preferred_booster_id/exclusive_until
-- de 12h -- exatamente como um pedido exclusivo novo. O booster antigo perde o
-- pedido na hora (some da lista dele); o novo só ganha de fato quando aceitar
-- (accept_boost_order), preservando todo o progresso (matches, rank, etc --
-- nada disso é tocado aqui, diferente de apply_order_drop que reseta tudo).
create or replace function public.admin_reassign_booster(p_order_id uuid, p_target_booster_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  set status = 'awaiting_assignment',
      assigned_booster_id = null,
      preferred_booster_id = p_target_booster_id,
      exclusive_until = now() + interval '12 hours',
      reassigned_by_admin = true,
      used_exclusive_slot = false,
      duo_own_riot_id = null,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'awaiting_assignment', auth.uid(), 'Reatribuído pelo admin: ' || v_reason);

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

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
    p_target_booster_id, 'exclusive_job', 'Pedido reatribuído para você!',
    'Um administrador reatribuiu este pedido a você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
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

-- accept_boost_order: mesma lógica de antes, só com o branch exclusivo
-- ciente de reassigned_by_admin -- não checa nem marca used_exclusive_slot
-- pra esse caso (reatribuição não disputa o slot exclusivo bônus real).
create or replace function public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('accept_boost_order', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set, reassigned_by_admin
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
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
    if not v_order.reassigned_by_admin and public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        used_exclusive_slot = not v_order.reassigned_by_admin,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido reatribuído' else 'Booster aceitou o pedido exclusivo' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', not v_order.reassigned_by_admin, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
  where id = p_order_id;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;

-- booster_active_slot_counts: reatribuição não conta pro limite normal de
-- 3/4 slots, igual coaching -- o booster pode aceitar quantas reatribuições
-- quiser sem isso consumir/bloquear pedidos normais.
create or replace function public.booster_active_slot_counts(p_booster_user_id uuid)
returns table(solo_count integer, duo_count integer, total_count integer)
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $$
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      count(*) filter (where boost_mode = 'solo')::integer,
      count(*) filter (where boost_mode = 'duo')::integer,
      count(*)::integer
    from public.orders
    where assigned_booster_id = p_booster_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
      and not used_exclusive_slot
      and service_type <> 'coaching'
      and not reassigned_by_admin;
end;
$$;
