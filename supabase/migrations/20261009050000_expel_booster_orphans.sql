-- M-52: expel_booster devolve saldo/saques pendentes e encerra as sessoes. Mesma assinatura (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.expel_booster(p_booster_id uuid, p_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor         record;
  v_booster       record;
  v_balance       numeric;
  v_pending       integer;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, user_id, status into v_booster
  from public.booster_profiles where id = p_booster_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  if v_booster.status <> 'removed' then
    if public.booster_has_open_orders(v_booster.user_id) then
      return jsonb_build_object('success', false, 'error', 'active_orders_exist');
    end if;
  end if;

  select id, role into v_actor from public.profiles where id = p_actor_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'actor_not_found');
  end if;

  update public.booster_profiles
  set status = 'removed', suspended_until = null, updated_at = now()
  where id = p_booster_id;

  update public.profiles
  set role = 'customer'::public.user_role, updated_at = now()
  where id = v_booster.user_id
    and role <> 'admin';

  -- Saldo e saques pendentes ficam para o admin decidir (nao somem em silencio).
  v_balance := public.booster_available_balance(v_booster.user_id);
  select count(*)::int into v_pending
  from public.payout_requests
  where booster_id = v_booster.user_id and status in ('requested', 'under_review', 'approved');

  -- Encerra as sessoes: o ban do GoTrue nao revoga os refresh tokens ja emitidos.
  delete from auth.sessions where user_id = v_booster.user_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'booster.removed', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', trim(p_reason), 'balance', v_balance, 'pending_payout_requests', v_pending));

  return jsonb_build_object('success', true, 'user_id', v_booster.user_id,
                            'balance', v_balance, 'pending_payout_requests', v_pending);
end;
$function$;
