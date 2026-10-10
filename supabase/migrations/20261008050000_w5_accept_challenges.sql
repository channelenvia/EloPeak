-- W5: captcha do aceite validado no servidor (H-22 / RN-12).
-- O campeao sorteado e a resposta nunca chegam ao navegador; a imagem sai por endpoint com id opaco.
set search_path = public, extensions;

create table public.accept_challenges (
  id uuid primary key default gen_random_uuid(),
  booster_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  champion_id text not null,
  answer_norm text not null,
  image_seed integer not null,
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  solved_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index accept_challenges_booster_idx on public.accept_challenges (booster_id, created_at desc);
alter table public.accept_challenges enable row level security;
revoke all on public.accept_challenges from anon, authenticated;

-- Emite um desafio novo (descarta os abertos do mesmo booster/pedido). Chamada so pela Edge (service_role).
create function public.issue_accept_challenge(p_booster_id uuid, p_order_id uuid, p_champion_id text, p_answer_norm text, p_seed integer)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.orders where id = p_order_id and status = 'awaiting_assignment') then
    raise exception 'order_unavailable';
  end if;
  update public.accept_challenges set used_at = now()
   where booster_id = p_booster_id and order_id = p_order_id and used_at is null;
  insert into public.accept_challenges(booster_id, order_id, champion_id, answer_norm, image_seed, expires_at)
  values (p_booster_id, p_order_id, p_champion_id, p_answer_norm, p_seed, now() + interval '3 minutes')
  returning id into v_id;
  return v_id;
end;
$function$;

-- Confere a resposta (3 tentativas). Acertou: o desafio fica valido por 2 min para o aceite.
create function public.verify_accept_challenge(p_challenge_id uuid, p_booster_id uuid, p_answer_norm text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  c public.accept_challenges%rowtype;
begin
  select * into c from public.accept_challenges where id = p_challenge_id for update;
  if not found or c.booster_id <> p_booster_id then
    return jsonb_build_object('success', false, 'error', 'challenge_not_found');
  end if;
  if c.used_at is not null or c.expires_at <= now() or c.solved_at is not null then
    return jsonb_build_object('success', false, 'error', 'challenge_expired');
  end if;
  if c.attempts >= 3 then
    return jsonb_build_object('success', false, 'error', 'too_many_attempts');
  end if;

  if p_answer_norm is not null and p_answer_norm <> '' and p_answer_norm = c.answer_norm then
    update public.accept_challenges set solved_at = now(), attempts = attempts + 1,
           expires_at = least(expires_at, now() + interval '2 minutes') where id = c.id;
    return jsonb_build_object('success', true);
  end if;

  update public.accept_challenges set attempts = attempts + 1,
         used_at = case when attempts + 1 >= 3 then now() else used_at end
   where id = c.id;
  return jsonb_build_object('success', false, 'error', 'wrong_answer', 'attempts_left', greatest(0, 2 - c.attempts));
end;
$function$;

-- Dados minimos para servir a imagem (so enquanto o desafio esta aberto).
create function public.get_accept_challenge_image_data(p_challenge_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object('champion_id', champion_id, 'seed', image_seed)
  from public.accept_challenges
  where id = p_challenge_id and used_at is null and solved_at is null and expires_at > now() and attempts < 3
$$;

revoke execute on function public.issue_accept_challenge(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.verify_accept_challenge(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.get_accept_challenge_image_data(uuid) from public, anon, authenticated;
grant execute on function public.issue_accept_challenge(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.verify_accept_challenge(uuid, uuid, text) to service_role;
grant execute on function public.get_accept_challenge_image_data(uuid) to service_role;

-- accept_boost_order passa a exigir o desafio resolvido (a assinatura antiga sai: nada de overload orfao).
drop function public.accept_boost_order(uuid, uuid);
CREATE OR REPLACE FUNCTION public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid, p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- RN-12: so aceita com um desafio resolvido no servidor (uso unico, TTL curto, do mesmo booster e pedido).
  update public.accept_challenges
     set used_at = now()
   where id = p_challenge_id and booster_id = p_booster_user_id and order_id = p_order_id
     and solved_at is not null and used_at is null and expires_at > now();
  if not found then
    return jsonb_build_object('success', false, 'error', 'captcha_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set, reassigned_by_admin
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if not public.is_approved_booster(p_booster_user_id) then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if v_order.preferred_booster_id is distinct from p_booster_user_id and exists (
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
revoke execute on function public.accept_boost_order(uuid, uuid, uuid) from public, anon;
grant execute on function public.accept_boost_order(uuid, uuid, uuid) to authenticated;

select cron.schedule('prune-accept-challenges', '15 4 * * *',
  $$delete from public.accept_challenges where created_at < now() - interval '1 day'$$);
