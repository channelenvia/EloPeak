-- W4: duo, reatribuicao, chat, reviews, coaching dropado, limpeza e indices
-- (H-17, H-18, H-20, H-21, H-37, H-38, M-12, M-16, M-17).
set search_path = public, extensions;

-- ===== H-17: reserva duo: qualquer liberacao da conta fecha o registro de reserva =====
create or replace function public.trg_fn_close_duo_reservation_on_release()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if old.reserved_order_id is not null and new.reserved_order_id is distinct from old.reserved_order_id then
    update public.duo_account_reservations
       set released_at = now()
     where account_id = old.id and order_id = old.reserved_order_id and released_at is null;
  end if;
  return new;
end;
$function$;
revoke execute on function public.trg_fn_close_duo_reservation_on_release() from public, anon, authenticated;
create trigger trg_duo_accounts_close_reservation after update of reserved_order_id on public.duo_accounts
  for each row execute function public.trg_fn_close_duo_reservation_on_release();

-- reservas abertas de pedidos que ja acabaram (ficavam travando a conta)
update public.duo_account_reservations r set released_at = now()
 where released_at is null
   and not exists (select 1 from public.duo_accounts a where a.id = r.account_id and a.reserved_order_id = r.order_id);

CREATE OR REPLACE FUNCTION public.reserve_duo_account(p_order_id uuid, p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_previous_account_id uuid;
  v_reserved_id uuid;
begin
  if not public.check_own_write_rate_limit('reserve_duo_account', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id, boost_mode, status, wins_played, losses_played into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_order_status');
  end if;

  select id into v_previous_account_id
  from public.duo_accounts where reserved_order_id = p_order_id for update;

  if v_previous_account_id is not null and v_previous_account_id = p_account_id then
    return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', true);
  end if;

  if v_previous_account_id is not null and (coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0)) > 0 then
    return jsonb_build_object('success', false, 'error', 'cannot_switch_after_matches_played');
  end if;

  begin
    if v_previous_account_id is not null then
      update public.duo_accounts
      set reserved_by = null, reserved_order_id = null, reserved_at = null,
          last_released_by = auth.uid(), last_released_at = now()
      where id = v_previous_account_id;

      update public.duo_account_reservations
      set released_at = now(), released_by = auth.uid()
      where account_id = v_previous_account_id and released_at is null;

      insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
      values (auth.uid(), 'booster'::public.user_role, 'duo_account.switched', 'order', p_order_id,
              jsonb_build_object('from_account_id', v_previous_account_id, 'to_account_id', p_account_id,
                                  'order_status_at_switch', v_order.status));
    end if;

    update public.duo_accounts
    set reserved_by = auth.uid(), reserved_order_id = p_order_id, reserved_at = now()
    where id = p_account_id
      and reserved_by is null
      and is_active = true
      and public.duo_account_rank_is_valid(current_rank)
    returning id into v_reserved_id;

    -- A nova conta indisponivel desfaz a liberacao da antiga (subtransacao): nada muda.
    if v_reserved_id is null then
      raise exception 'account_unavailable' using errcode = 'P0001';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'account_unavailable' then
      return jsonb_build_object('success', false, 'error', 'account_unavailable');
    end if;
    raise;
  end;

  insert into public.duo_account_reservations(account_id, order_id, booster_id)
  values (p_account_id, p_order_id, auth.uid());

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'duo_account.reserved', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', false);
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
  select coalesce(array_agg(distinct t), '{}')
  into v_valid_mentions
  from unnest(coalesce(p_mentioned_user_ids, '{}')) as t
  where t <> v_user_id
    and (
      t = v_order.customer_id
      or t = v_order.assigned_booster_id
      or exists (select 1 from public.profiles where id = t and role = 'admin'::public.user_role)
    )
  limit 3;  -- no maximo 3 mencoes por mensagem

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

CREATE OR REPLACE FUNCTION public.get_order_chat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_messages jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.assigned_booster_id is not null then
    select coalesce(jsonb_agg(row_data order by row_data->>'created_at'), '[]'::jsonb)
    into v_messages
    from (
      select jsonb_build_object(
        'id', m.id,
        'order_id', m.order_id,
        'sender_id', m.sender_id,
        'sender_role', m.sender_role,
        'sender_name', case
          when m.sender_role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
          when m.sender_role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
          else coalesce(p.username, 'Cliente')
        end,
        'sender_avatar_url', p.avatar_url,
        'content', m.content,
        'created_at', m.created_at,
        'is_read', m.is_read
      ) as row_data
      from (
        select om.*
        from public.order_messages om
        where om.order_id = p_order_id
        order by om.created_at desc
        limit 300
      ) m
      join public.profiles p on p.id = m.sender_id
      left join public.booster_profiles bp
        on bp.user_id = m.sender_id
       and m.sender_role = 'booster'::public.user_role
    ) messages;
  end if;

  return jsonb_build_object(
    'success', true,
    'chat_available', v_order.assigned_booster_id is not null,
    'chat_locked', v_order.chat_locked,
    'chat_locked_at', v_order.chat_locked_at,
    'can_send',
      v_order.assigned_booster_id is not null
      and (v_role = 'admin'::public.user_role
           or (not v_order.chat_locked and v_order.status not in ('canceled', 'refunded'))),
    'messages', v_messages
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_order_drop(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requester_role drop_requester_role, p_coaching_completion_pct numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order                 record;
  v_is_top3                boolean;
  v_share_pct              numeric;
  v_is_positive            boolean;
  v_over_limit             boolean;
  v_payout                 numeric := 0;
  v_penalty                numeric := 0;
  v_new_total_price        numeric;
  v_new_wins_purchased     integer;
  v_new_estimated_hours    numeric;
  v_new_current_rank       jsonb;
  v_latest_rank            record;
  v_win_value_unit         numeric;
  v_division_value_full    numeric;
  v_win_value_master_cents integer;
  v_win_value_master_full  numeric;
  v_win_value_master_share numeric;
  v_latest_pdl             integer;
  v_new_current_pdl        integer;
  v_f                      numeric;
  v_unit_ratio             numeric;
  v_consumed               numeric;
  v_net                    integer;
  v_complete               boolean := false;
begin
  select id, service_type, boost_mode, queue_type, total_price, current_rank, target_rank,
         current_pdl, customer_id, assigned_booster_id, estimated_hours, wins_played,
         losses_played, wins_purchased, drop_count, status
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned');
  end if;

  if v_order.status::text <> p_from_status then
    return jsonb_build_object('success', false, 'error', 'order_status_mismatch');
  end if;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id for update;
  -- Coaching tem taxa própria e fixa (70%, ver trg_fn_order_completed_booster_stats
  -- e boosterEarningsShare em src/lib/utils.ts) -- não varia com is_top3.
  v_share_pct := case
    when v_order.service_type = 'coaching' then 0.70
    when v_is_top3 then 0.60
    else 0.55
  end;

  v_is_positive := case
    when v_order.service_type in ('win_boost', 'md5', 'elo_boost')
      then coalesce(v_order.wins_played, 0) >= coalesce(v_order.losses_played, 0)
    else true
  end;
  v_over_limit  := v_order.drop_count >= 2;
  v_new_current_pdl := v_order.current_pdl;

  -- ── Limite de 2 drops: cancela em vez de reabrir, tudo manual daqui ────
  if v_over_limit then
    update public.orders set
      status                = 'under_review',
      assigned_booster_id   = null,
      preferred_booster_id  = null,
      exclusive_until       = null,
      used_exclusive_slot   = false,
      duo_own_riot_id       = null,
      drop_count            = drop_count + 1,
      last_dropped_at       = now(),
      updated_at            = now()
    where id = p_order_id;

    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = p_order_id;

    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, p_from_status::public.order_status, 'under_review', p_actor_id,
      'Limite de 2 drops atingido -- pedido cancelado; reembolso do cliente e saldo do booster pendentes de resolução manual. ' || p_reason
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido atingiu o limite de drops e está sendo analisado manualmente pela nossa equipe. Entraremos em contato pelo chat do pedido.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido que você tinha foi cancelado após atingir o limite de drops e está em análise manual da equipe.',
      jsonb_build_object('order_id', p_order_id)
    );

    return jsonb_build_object('success', true, 'under_review', true, 'drop_count', v_order.drop_count + 1);
  end if;

  -- ── Progresso do booster atual (mesma definicao do cancelamento e das telas) ──
  select fraction, unit_ratio into v_f, v_unit_ratio
    from public._order_progress_detail(p_order_id, p_coaching_completion_pct);
  v_f := coalesce(v_f, 0);
  v_consumed := round(v_order.total_price * v_f, 2);
  v_new_wins_purchased := v_order.wins_purchased;
  v_new_estimated_hours := v_order.estimated_hours;
  v_new_current_rank := v_order.current_rank;

  -- ── Win Boost / MD5 ──────────────────────────────────────────────────
  if v_order.service_type in ('win_boost', 'md5') then
    v_win_value_unit := case
      when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
      else 0
    end;
    v_net := greatest(0, coalesce(v_order.wins_played, 0) - coalesce(v_order.losses_played, 0));

    if v_is_positive then
      -- Empate (ex.: 3V/3D) nao paga nada: so o saldo liquido de vitorias conta.
      v_new_wins_purchased := greatest(0, coalesce(v_order.wins_purchased, 0) - v_net);
      v_payout := round(v_consumed * v_share_pct, 2);
    else
      v_new_wins_purchased := greatest(0,
        coalesce(v_order.wins_purchased, 0) - coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0));
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_unit, round(v_win_value_unit * v_share_pct, 2), v_order.losses_played);
    end if;
    v_new_total_price := round(v_win_value_unit * v_new_wins_purchased, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null and coalesce(v_order.wins_purchased, 0) > 0
        then round(v_order.estimated_hours / v_order.wins_purchased * v_new_wins_purchased, 2)
      else v_order.estimated_hours
    end;

  -- ── Elo/Duo Boost: rank atual/alvo nulos e um estado invalido ─────────────
  elsif v_order.service_type = 'elo_boost' and (v_order.current_rank is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ ─────────────────────────────────────────────
  elsif v_order.service_type = 'elo_boost'
    and (v_order.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then

    select fetched_tier, fetched_division, fetched_lp
    into v_latest_rank
    from public.order_rank_verifications
    where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;

    v_latest_pdl := coalesce(v_latest_rank.fetched_lp, v_order.current_pdl, 0);
    v_new_current_pdl := v_latest_pdl;
    v_new_current_rank := case
      when v_latest_rank.fetched_tier is not null
        then jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division)
      else v_order.current_rank
    end;

    if v_is_positive then
      v_payout := round(v_consumed * v_share_pct, 2);
      v_new_total_price := greatest(0, round(v_order.total_price - v_consumed, 2));
    else
      v_win_value_master_cents := public.win_price_cents(
        v_order.queue_type, v_order.boost_mode,
        coalesce(v_latest_rank.fetched_tier, v_order.current_rank->>'tier'));
      v_win_value_master_full := v_win_value_master_cents / 100.0;
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_master_full, round(v_win_value_master_full * v_share_pct, 2), v_order.losses_played);
      -- O progresso (se houve) sai do preco; a penalidade vai inteira para o proximo booster.
      v_new_total_price := round(v_order.total_price - v_consumed + v_penalty, 2);
    end if;

  -- ── Elo/Duo Boost -- padrao (abaixo de Mestre) ──────────────────────────
  elsif v_order.service_type = 'elo_boost' then
    select fetched_tier, fetched_division into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id and created_at >= coalesce((select max(assigned_at) from public.order_booster_assignments where order_id = p_order_id and unassigned_at is null), '-infinity') order by created_at desc limit 1;
    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
    end if;

    if v_is_positive then
      v_payout := round(v_consumed * v_share_pct, 2);
      v_new_total_price := greatest(0, round(v_order.total_price - v_consumed, 2));
    else
      -- Cada derrota custa 1/4 do valor do degrau em disputa (peso real do degrau, nao a media).
      v_division_value_full := round(v_order.total_price * coalesce(v_unit_ratio, 0), 2);
      v_penalty := public.compute_drop_penalty(
        p_requester_role, round(v_division_value_full / 4.0, 2),
        round(v_division_value_full * v_share_pct / 4.0, 2), v_order.losses_played);
      v_new_total_price := round(v_order.total_price - v_consumed + v_penalty, 2);
    end if;

  -- ── Clash, coaching e placement: so existe drop positivo (progresso x preco) ──
  else
    v_new_total_price := round(v_order.total_price - v_consumed, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null then round(v_order.estimated_hours * (1 - v_f), 2)
      else null
    end;
    v_payout := round(v_consumed * v_share_pct, 2);
  end if;

  -- Nada mais a entregar: conclui em vez de reabrir um pedido de preco zero.
  -- O trigger de conclusao paga o booster sobre o preco vigente (sem somar v_payout).
  v_complete := v_is_positive and v_new_total_price <= 0 and v_order.total_price > 0;

  if v_complete then
    update public.orders set status = 'completed', completed_at = now(), updated_at = now(),
           settled_value = settled_value + v_consumed
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, p_from_status::public.order_status, 'completed', p_actor_id,
            'Objetivo ja entregue ao solicitar o drop -- pedido concluido. ' || p_reason);
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_completed', 'Pedido concluido',
            'O objetivo do seu pedido ja tinha sido entregue e ele foi concluido.',
            jsonb_build_object('order_id', p_order_id));
    return jsonb_build_object('success', true, 'completed', true, 'payout_amount', 0, 'penalty_amount', 0,
                              'new_total_price', v_order.total_price, 'is_positive', true);
  end if;

  -- ── Aplica o resultado ao pedido ────────────────────────────────────
  update public.orders set
    status                 = case when v_order.service_type = 'coaching' then 'under_review'::public.order_status else 'awaiting_assignment'::public.order_status end,
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    duo_own_riot_id        = null,
    total_price            = v_new_total_price,
    base_price             = v_new_total_price,
    extras_price           = 0,
    discount_price         = 0,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    current_pdl            = v_new_current_pdl,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    settled_value          = settled_value + v_consumed,
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id
    and booster_id = v_order.assigned_booster_id
    and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status,
          case when v_order.service_type = 'coaching' then 'under_review'::public.order_status else 'awaiting_assignment'::public.order_status end,
          p_actor_id, p_reason);

  -- Coaching nao volta ao pool (so o coach dono do pacote enxerga): o admin escolhe o novo coach.
  if v_order.service_type = 'coaching' then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'coaching_needs_new_coach', 'Coaching sem coach',
           'O coach largou o pedido ' || p_order_id::text || '. Escolha um novo coach em Atribuir booster.',
           jsonb_build_object('order_id', p_order_id)
    from public.profiles where role = 'admin';
  end if;

  if v_payout > 0 then
    update public.booster_profiles set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial pelo progresso entregue no pedido ' || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'R$ ' || v_payout::text || ' foi creditado ao seu saldo pelo progresso entregue antes do drop.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout)
    );
  end if;

  if v_penalty > 0 then
    -- Espelha o crédito de payout logo acima -- sem isso, total_earnings
    -- (exibido ao admin em BoosterDetail.tsx) ficava inflado depois de
    -- qualquer drop com penalidade (o saldo sacável real já vinha certo,
    -- por ser derivado do ledger via booster_available_balance).
    update public.booster_profiles set total_earnings = total_earnings - v_penalty
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_penalty,
      'Penalidade por drop em desvantagem no pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Penalidade de drop aplicada',
      'R$ ' || v_penalty::text || ' foi descontado do seu saldo por dropar o pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_penalty)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payout_amount', v_payout,
    'penalty_amount', v_penalty,
    'new_total_price', v_new_total_price,
    'is_positive', v_is_positive,
    'progress_fraction', v_f
  );
end;
$function$;

-- ===== H-20: moderacao de reviews (so admin, com auditoria) =====
create or replace function public.admin_moderate_review(p_review_id uuid, p_is_public boolean, p_note text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_old record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if not public.check_own_write_rate_limit('admin_moderate_review', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select id, is_public, is_moderated, admin_note into v_old from public.reviews where id = p_review_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'review_not_found');
  end if;
  update public.reviews
     set is_public = p_is_public, is_moderated = true, admin_note = nullif(btrim(p_note), '')
   where id = p_review_id;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'review.moderated', 'review', p_review_id::text,
          jsonb_build_object('from', jsonb_build_object('is_public', v_old.is_public, 'note', v_old.admin_note),
                             'to', jsonb_build_object('is_public', p_is_public, 'note', nullif(btrim(p_note), ''))));
  return jsonb_build_object('success', true);
end;
$function$;
revoke execute on function public.admin_moderate_review(uuid, boolean, text) from public, anon;
grant execute on function public.admin_moderate_review(uuid, boolean, text) to authenticated;

-- ===== M-12: pedido que sai de drop_requested por outro caminho nao deixa pedido de drop pendente =====
create or replace function public.trg_fn_close_pending_drop_requests()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if old.status = 'drop_requested' and new.status <> 'drop_requested' then
    update public.order_drop_requests
       set status = 'rejected', resolved_at = now(),
           admin_note = coalesce(admin_note, 'Encerrado automaticamente: o pedido saiu de drop_requested')
     where order_id = new.id and status = 'pending';
  end if;
  return new;
end;
$function$;
revoke execute on function public.trg_fn_close_pending_drop_requests() from public, anon, authenticated;
create trigger trg_orders_close_pending_drop_requests after update of status on public.orders
  for each row execute function public.trg_fn_close_pending_drop_requests();

-- ===== H-37 / M-16: manutencao (historico do cron, eventos, notificacoes lidas, rate limits) =====
create or replace function public.prune_old_data()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.booster_profile_events where created_at < now() - interval '90 days';
  delete from public.notifications where is_read and created_at < now() - interval '60 days';
  delete from public.edge_rate_limits where window_started_at < now() - interval '1 day';
end;
$function$;
revoke execute on function public.prune_old_data() from public, anon, authenticated;
select cron.schedule('prune-old-data', '0 4 * * *', 'select public.prune_old_data();');

-- release de pedidos em revisao: 10 s -> 1 min (a janela de revisao e de 2 min)
select cron.unschedule('release-pending-review-orders');
select cron.schedule('release-pending-review-orders', '* * * * *', 'select public.release_pending_review_orders();');

-- ===== M-17: indices em FKs usadas por joins/RLS =====
create index if not exists order_booster_assignments_booster_idx on public.order_booster_assignments (booster_id);
create index if not exists duo_account_reservations_order_idx on public.duo_account_reservations (order_id);
create index if not exists duo_account_reservations_booster_idx on public.duo_account_reservations (booster_id);
create index if not exists booster_order_events_order_idx on public.booster_order_events (order_id);
create index if not exists orders_customer_status_created_idx on public.orders (customer_id, status, created_at desc);
create index if not exists orders_booster_status_created_idx on public.orders (assigned_booster_id, status, created_at desc) where assigned_booster_id is not null;
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists order_messages_order_created_idx on public.order_messages (order_id, created_at desc);
