-- W-2: estados presos e reatribuicao.
-- H-1 liberar analise vinda de drop_requested volta a in_progress; M-1 nao libera ao pool com reembolso pendente;
-- H-11 accept (nao exclusivo) limpa reassigned_by_admin; H-12 reassign nao segue apos apply_order_drop completar.
-- Mesmas assinaturas (CREATE OR REPLACE) -- sem overload orfao.
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION "public"."_release_pending_review_order"("p_order_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order            record;
  v_exclusive_until  timestamptz;
  v_restored_status  public.order_status;
begin
  select id, status, customer_id, preferred_booster_id, service_type,
         assigned_booster_id, under_review_from_status, under_review_started_at
  into v_order
  from public.orders
  where id = p_order_id and status in ('pending_review', 'under_review')
  for update;

  if not found then
    return;
  end if;

  if v_order.assigned_booster_id is not null then
    v_restored_status := coalesce(v_order.under_review_from_status, 'assigned'::public.order_status);
    -- H-1: flagar analise fecha o pedido de drop pendente (trigger); voltar a drop_requested deixaria o
    -- pedido preso sem solicitacao para resolver. O booster segue e pode pedir de novo.
    if v_restored_status = 'drop_requested' and not exists (
      select 1 from public.order_drop_requests where order_id = p_order_id and status = 'pending'
    ) then
      v_restored_status := 'in_progress';
    end if;

    update public.orders
    set status                    = v_restored_status,
        match_sync_started_at     = case
          when match_sync_started_at is not null and v_order.under_review_started_at is not null
            then match_sync_started_at + (now() - v_order.under_review_started_at)
          else match_sync_started_at
        end,
        under_review_from_status  = null,
        under_review_started_at   = null,
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_restored_status, coalesce(p_actor_id, v_order.customer_id), p_reason);

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido liberado',
      'O pedido que estava em análise foi liberado -- você pode continuar de onde parou.',
      jsonb_build_object('order_id', p_order_id)
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido liberado',
        'A análise do seu pedido foi concluída -- ele voltou a andar normalmente.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    return;
  end if;

  -- M-1: reembolso pendente -> o pedido nao volta ao pool com preco integral.
  if exists (select 1 from public.refunds where order_id = p_order_id and status = 'pending') then
    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null and v_order.service_type <> 'coaching'
      then now() + interval '9 hours'
    else null
  end;

  update public.orders
  set status               = 'awaiting_assignment',
      exclusive_until      = v_exclusive_until,
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

  if v_order.preferred_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.preferred_booster_id, 'exclusive_job', 'Pedido exclusivo para você!',
      'Um pedido foi reservado pra você. Você tem 9 horas para aceitar antes que ele volte para a fila geral.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status, assigned_booster_id into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  if p_locked then
    update public.orders set admin_review_locked = true, updated_at = now() where id = p_order_id;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_locked', 'order', p_order_id::text, '{}'::jsonb);
  else
    if v_order.assigned_booster_id is null and exists (select 1 from public.refunds where order_id = p_order_id and status = 'pending') then
      return jsonb_build_object('success', false, 'error', 'refund_pending');
    end if;
    perform public._release_pending_review_order(p_order_id, auth.uid(), 'Liberado manualmente pelo admin');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_unlocked', 'order', p_order_id::text, '{}'::jsonb);
  end if;

  return jsonb_build_object('success', true);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_target record;
  v_reason text := coalesce(trim(p_reason), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, service_type, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;
  if v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_has_active_booster');
  end if;
  if exists (select 1 from public.refunds where order_id = p_order_id and status = 'pending') then
    return jsonb_build_object('success', false, 'error', 'refund_pending');
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set status                = 'awaiting_assignment',
      preferred_booster_id  = p_target_booster_id,
      exclusive_until       = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at            = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, v_order.status, 'awaiting_assignment', auth.uid(),
    case when v_reason <> '' then 'Atribuído pelo admin: ' || v_reason else 'Atribuído pelo admin' end
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'exclusive_job', 'Pedido reservado para você!',
    'Um administrador reservou este pedido pra você. Você tem 9 horas para aceitar antes que ele volte para a fila geral.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_assigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'target_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

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
  -- Termos vigentes aceitos (relogio e versao do servidor; antes do captcha para nao queimar o desafio).
  if not exists (
    select 1 from public.profiles
    where id = p_booster_user_id
      and terms_accepted_at is not null and privacy_accepted_at is not null
      and legal_version = public.current_legal_version()
  ) then
    return jsonb_build_object('success', false, 'error', 'legal_not_accepted');
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

  -- H-11: accept pelo pool (fora da exclusividade) consome slot; zera a isencao da reatribuicao.
  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      reassigned_by_admin = false,
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

CREATE OR REPLACE FUNCTION public.admin_reassign_booster(p_order_id uuid, p_target_booster_id uuid, p_reason text, p_coaching_completion_pct numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order              record;
  v_reason             text := coalesce(trim(p_reason), '');
  v_target             record;
  v_result             jsonb;
  v_is_new_assignment  boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, last_match_synced_at, customer_id, service_type, drop_count
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
    if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
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

  -- 3o drop vai para analise manual: nao reatribui (antes o apply comitava e a funcao devolvia erro).
  if not v_is_new_assignment and coalesce(v_order.drop_count, 0) >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  if not v_is_new_assignment then
    v_result := public.apply_order_drop(
      p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role,
      p_coaching_completion_pct
    );

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;

    -- H-12: o drop concluiu o pedido (progresso 100%): nao ha o que reatribuir.
    if coalesce((v_result->>'completed')::boolean, false) then
      return jsonb_build_object('success', true, 'completed', true, 'drop_result', v_result);
    end if;
  end if;

  update public.orders
  set status = case when v_order.service_type = 'coaching' and not v_is_new_assignment then 'awaiting_assignment'::public.order_status else status end,
      preferred_booster_id = p_target_booster_id,
      -- Coaching é reserva permanente do dono do pacote (mesmo critério de
      -- _release_pending_review_order) -- nunca expira, mesmo reatribuído.
      exclusive_until      = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      reassigned_by_admin  = true,
      duo_own_riot_id      = null,
      updated_at           = now()
  where id = p_order_id;

  -- Coaching dropado fica em analise (apply_order_drop); a reatribuicao devolve o pedido a fila do coach escolhido.
  if v_order.service_type = 'coaching' and not v_is_new_assignment then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'under_review', 'awaiting_assignment', auth.uid(), 'Coaching reatribuido pelo admin: ' || coalesce(nullif(v_reason, ''), 'sem motivo'));
  end if;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin',
    case when v_is_new_assignment then 'Um pedido foi reservado pra você' else 'Um pedido foi reatribuído a você' end,
    'Um administrador reservou este pedido pra você -- você tem 9 horas para aceitar na aba Jobs.'
      || case when v_reason <> '' then ' Motivo: ' || v_reason else '' end,
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

  if v_is_new_assignment then
    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-order-channel',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object(
        'record', jsonb_build_object(
          'id', p_order_id, 'status', 'awaiting_assignment',
          'discord_voice_channel_id', null, 'discord_text_channel_id', null
        ),
        'old_record', jsonb_build_object('status', 'assigned')
      ),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true, 'drop_result', v_result);
end;
$function$;
