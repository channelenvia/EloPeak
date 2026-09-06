-- Achado do code-review desta sessão: admin_reassign_booster (migration
-- 20260905140000) seta exclusive_until = now() + 12h incondicionalmente,
-- sem o guard de service_type = 'coaching' -- reintroduz exatamente o bug
-- que 20260905130000 tinha acabado de corrigir em _release_pending_review_
-- order (coaching é reserva PERMANENTE, exclusive_until deve ficar sempre
-- null pra esse service_type). accept_boost_order/announce-expired-
-- exclusive-jobs já tratam coaching certo independente de exclusive_until,
-- então isso não vazava pro público nem quebrava o aceite -- mas deixava um
-- prazo de 12h falso gravado num pedido que nunca deveria expirar.
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
  v_reason             text := trim(p_reason);
  v_target             record;
  v_result             jsonb;
  v_is_new_assignment  boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
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
      exclusive_until      = case when v_order.service_type = 'coaching' then null else now() + interval '12 hours' end,
      reassigned_by_admin  = true,
      duo_own_riot_id      = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin',
    case when v_is_new_assignment then 'Um pedido foi reservado pra você' else 'Um pedido foi reatribuído a você' end,
    'Um administrador reservou este pedido pra você -- você tem 12 horas para aceitar na aba Jobs. Motivo: ' || v_reason,
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

revoke all on function public.admin_reassign_booster(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reassign_booster(uuid, uuid, text) to authenticated;
