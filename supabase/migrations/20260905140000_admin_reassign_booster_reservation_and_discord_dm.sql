-- admin_reassign_booster atribuía o booster escolhido pelo admin NA HORA
-- (status='assigned' direto, sem o booster nem saber previamente) -- a
-- coluna reassigned_by_admin e o tratamento dela em accept_boost_order
-- (bypassa o limite de slots/exclusivo, mensagem de histórico própria) já
-- existiam há tempo pra suportar o fluxo correto (reserva -- o pedido cai
-- na aba Jobs do booster escolhido, roxo "Reatribuído" em vez do amarelo
-- "Exclusivo", ele precisa aceitar), mas nada nunca setava a coluna.
--
-- Fix: em vez de atribuir direto, reserva via preferred_booster_id +
-- exclusive_until (mesmo mecanismo de reserva de 12h já usado por qualquer
-- pedido "exclusivo"), com reassigned_by_admin=true. O booster precisa
-- aceitar (accept_boost_order) pra virar de fato assigned/in_progress.
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

  select id, status, assigned_booster_id, last_match_synced_at, customer_id
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

  -- Só quando já havia um booster ativo: aplica a mesma fórmula de drop
  -- (valor corrigido pelo progresso, limite de 2 trocas) antes de liberar
  -- o pedido pro novo booster escolhido. Essa chamada já deixa o pedido em
  -- awaiting_assignment com preferred_booster_id null -- o update logo
  -- abaixo sobrescreve pro booster de destino na mesma transação.
  if not v_is_new_assignment then
    v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role);

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;
  end if;

  -- Reserva o pedido pro booster escolhido em vez de atribuir na hora: ele
  -- precisa aceitar (mesmo fluxo de um exclusivo), aparece na aba Jobs como
  -- "Reatribuído" (roxo, ver AvailableJobs.tsx) em vez de assumir o pedido
  -- sem nem saber. reassigned_by_admin=true faz accept_boost_order ignorar
  -- o limite normal de slots e o de 1 exclusivo -- não foi o booster que
  -- escolheu isso, foi entregue a ele.
  update public.orders
  set preferred_booster_id = p_target_booster_id,
      exclusive_until      = now() + interval '12 hours',
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

  -- Só dispara a DM manualmente quando NÃO havia um drop antes: nesse caso
  -- (v_is_new_assignment) o pedido já estava em awaiting_assignment o tempo
  -- todo, sem transição de status pra disparar o trigger genérico sozinho
  -- (trg_notify_discord_order_webhook só escuta UPDATE OF status). Quando
  -- havia booster ativo, apply_order_drop já faz uma transição real de
  -- status (X -> awaiting_assignment) que dispara o trigger naturalmente --
  -- o webhook é assíncrono (pg_net só entrega depois do commit desta
  -- transação inteira), então por essa altura ele já vê preferred_booster_id
  -- e reassigned_by_admin com o valor final setado logo acima. Repetir a
  -- chamada manual aqui pra esse caso mandaria a DM em dobro.
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
        -- old_record.status sintético (qualquer coisa != awaiting_assignment)
        -- só serve pra passar no gate do discord-order-channel -- ele
        -- reconfere status/preferred_booster_id direto no banco antes de
        -- decidir o que mandar, então o valor aqui não afeta a decisão real.
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
