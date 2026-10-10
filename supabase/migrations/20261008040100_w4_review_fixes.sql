-- W4 (correcoes da revisao): coaching reatribuido volta a fila, cap real de 3 mencoes, released_by, indices redundantes.
set search_path = public, extensions;

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

CREATE OR REPLACE FUNCTION public.send_order_message(p_order_id uuid, p_content text, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_message_id uuid;
  v_valid_mentions uuid[];
  v_mentioned_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'code', 'chat_unavailable', 'message', 'O chat sera liberado quando um booster for atribuido.');
  end if;

  if v_order.status in ('canceled', 'refunded') and v_role <> 'admin'::public.user_role then
    return jsonb_build_object('success', false, 'code', 'chat_closed', 'message', 'O chat deste pedido foi encerrado.');
  end if;

  if v_order.chat_locked and v_role <> 'admin'::public.user_role then
    return jsonb_build_object('success', false, 'code', 'chat_locked', 'message', 'O chat foi bloqueado pela administracao.');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'A mensagem deve ter entre 1 e 4000 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('order_chat_' || replace(p_order_id::text, '-', ''), 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  end if;

  -- Só marca de verdade quem é participante real do pedido (cliente, booster
  -- atribuído ou algum admin) e nunca o próprio remetente -- o payload vem do
  -- cliente, sem essa reconferência um usuário podia alegar ter mencionado
  -- qualquer uuid e gerar notificação/DM falsa pra alguém fora do pedido.
  select coalesce((array_agg(distinct t))[1:3], '{}')
  into v_valid_mentions
  from unnest(coalesce(p_mentioned_user_ids, '{}')) as t
  where t <> v_user_id
    and (
      t = v_order.customer_id
      or t = v_order.assigned_booster_id
      or exists (select 1 from public.profiles where id = t and role = 'admin'::public.user_role)
    );  -- no maximo 3 mencoes por mensagem

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read, mentioned_user_ids)
  values (p_order_id, v_user_id, v_role, v_content, false, v_valid_mentions)
  returning id into v_message_id;

  foreach v_mentioned_id in array v_valid_mentions loop
    -- Sem repetir a mesma mencao (usuario, pedido) em 5 min e sem copiar o texto da mensagem.
    continue when exists (
      select 1 from public.notifications n
      where n.user_id = v_mentioned_id and n.type = 'chat_mention'
        and (n.data->>'order_id')::uuid = p_order_id and n.created_at > now() - interval '5 minutes');

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_mentioned_id, 'chat_mention', 'Você foi mencionado',
      'Você foi mencionado no chat de um pedido.',
      jsonb_build_object('order_id', p_order_id, 'message_id', v_message_id)
    );

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-chat-mention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('user_id', v_mentioned_id, 'order_id', p_order_id, 'body', 'Você foi mencionado no chat de um pedido.'),
      timeout_milliseconds := 10000
    );
  end loop;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_close_duo_reservation_on_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.reserved_order_id is not null and new.reserved_order_id is distinct from old.reserved_order_id then
    update public.duo_account_reservations
       set released_at = now(), released_by = coalesce(auth.uid(), released_by)
     where account_id = old.id and order_id = old.reserved_order_id and released_at is null;
  end if;
  return new;
end;
$function$;

-- indices que os novos compostos tornam redundantes (menos custo de escrita em orders/notifications/order_messages)
drop index if exists public.orders_customer_id_idx;
drop index if exists public.orders_booster_id_idx;
drop index if exists public.notifications_user_idx;
drop index if exists public.order_messages_order_idx;
