-- Nova ação exclusiva do admin: trocar o booster atribuído a um pedido em
-- andamento por qualquer outro booster da aplicação, ignorando o limite de
-- slots (can_booster_accept_order) -- pra casos bem específicos onde o admin
-- precisa intervir manualmente (ex.: booster antigo sumiu, cliente pediu
-- outro específico, etc). Slots continuam valendo normalmente pro fluxo
-- normal de accept_boost_order; isso aqui é só a exceção administrativa.
--
-- Não muda orders.status (só assigned_booster_id), então não precisa de
-- insert em order_status_history -- fica registrado em audit_logs.
--
-- Trava de sync antes de reatribuir um pedido 'in_progress' (mesmo
-- 'sync_required_before_drop' do request_order_drop, migration
-- 20260828120000): sem isso, uma partida jogada pelo booster antigo mas
-- sincronizada só depois da troca ficaria atribuída ao novo booster
-- (mesma classe de bug corrigida na migration 20260828110000).

create or replace function public.admin_list_boosters_with_slots()
returns table(
  id uuid,
  user_id uuid,
  display_name text,
  status public.booster_status,
  is_top3 boolean,
  solo_count integer,
  duo_count integer,
  total_count integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      bp.id,
      bp.user_id,
      bp.display_name,
      bp.status,
      bp.is_top3,
      coalesce(o.solo_count, 0)::integer,
      coalesce(o.duo_count, 0)::integer,
      coalesce(o.total_count, 0)::integer
    from public.booster_profiles bp
    left join lateral (
      select
        count(*) filter (where boost_mode = 'solo') as solo_count,
        count(*) filter (where boost_mode = 'duo')   as duo_count,
        count(*)                                     as total_count
      from public.orders
      where assigned_booster_id = bp.user_id
        and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
    ) o on true
    order by bp.display_name asc;
end;
$$;

revoke all on function public.admin_list_boosters_with_slots() from public, anon, authenticated;
grant execute on function public.admin_list_boosters_with_slots() to authenticated;

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

  select id, status, assigned_booster_id, last_match_synced_at
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

  select user_id, display_name into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;

  update public.orders
  set assigned_booster_id = p_target_booster_id, updated_at = now()
  where id = p_order_id;

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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id, 'new_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_reassign_booster(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reassign_booster(uuid, uuid, text) to authenticated;
