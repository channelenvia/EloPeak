-- Pedido: janela de exclusividade de pedidos exclusivos/atribuídos caindo de
-- 12h para 9h -- prazo máximo pro booster aceitar antes de voltar pro pool
-- geral (ou, no caso de reatribuição de pedido já ativo, antes que a
-- exclusividade some). Ajusta as três RPCs que gravam exclusive_until:
-- _release_pending_review_order (fim da janela de revisão com preferred
-- booster), admin_assign_pending_review_order (atribuição direta a partir da
-- revisão) e admin_reassign_booster (reatribuição de pedido ativo). Bodies
-- copiados das últimas definições (20260908050000 e 20260908030000
-- respectivamente), só trocando interval '12 hours' -> '9 hours' e o texto
-- das notificações.

create or replace function public._release_pending_review_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.admin_assign_pending_review_order(p_order_id uuid, p_target_booster_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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

create or replace function public.admin_reassign_booster(
  p_order_id uuid,
  p_target_booster_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  select id, status, assigned_booster_id, last_match_synced_at, customer_id, service_type
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
    if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
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

  if not v_is_new_assignment then
    v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role);

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;
  end if;

  update public.orders
  set preferred_booster_id = p_target_booster_id,
      -- Coaching é reserva permanente do dono do pacote (mesmo critério de
      -- _release_pending_review_order) -- nunca expira, mesmo reatribuído.
      exclusive_until      = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      reassigned_by_admin  = true,
      duo_own_riot_id      = null,
      updated_at           = now()
  where id = p_order_id;

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
$$;
