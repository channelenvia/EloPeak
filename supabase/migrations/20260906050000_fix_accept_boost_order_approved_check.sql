-- Bug: accept_boost_order deixa um booster não-aprovado aceitar pedido pelos
-- atalhos de coaching-preferido e de slot exclusivo.
--
-- O caminho genérico (fim da função) chama can_booster_accept_order, que
-- reconfirma booster_profiles.status = 'approved' antes de liberar o aceite.
-- Os dois atalhos anteriores -- "coaching com preferred_booster_id = eu" e
-- "v_is_exclusive" -- só checam uso de slot/preferência e nunca revalidam o
-- status do booster. Um booster suspenso/rejeitado que ainda seja o
-- preferred_booster_id de um pedido (ex.: reatribuído antes de ser suspenso)
-- consegue assumir o pedido mesmo sem estar aprovado.
--
-- Fix: revalidar status = 'approved' logo após travar a linha do pedido,
-- antes de qualquer branch, igual ao que can_booster_accept_order já garante
-- pro caminho genérico.
create or replace function public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if not exists (
    select 1 from public.booster_profiles
    where user_id = p_booster_user_id and status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
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
     and v_order.preferred_booster_id <> p_booster_user_id
     and (
       v_order.service_type = 'coaching'
       or (v_order.exclusive_until is not null and v_order.exclusive_until > now())
     ) then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  if v_order.service_type = 'coaching' and v_order.preferred_booster_id = p_booster_user_id then
    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido de coaching reatribuído' else 'Booster aceitou o pedido de coaching' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', false, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null and v_order.exclusive_until > now();

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
$function$;
