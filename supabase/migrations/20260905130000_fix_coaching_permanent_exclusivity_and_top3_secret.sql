-- Bug 1: coaching é reserva PERMANENTE do dono do pacote (não uma reserva
-- de 12h como pedido direto de perfil comum), mas _release_pending_review_
-- order calculava exclusive_until igual pra qualquer preferred_booster_id,
-- coaching incluído. Depois de 12h sem o booster aceitar:
--   - announce-expired-exclusive-jobs (exclusive_until <= now()) anunciava o
--     pedido de coaching PUBLICAMENTE no canal de jobs do Discord, mesmo ele
--     continuando invisível pra qualquer outro booster na aba de jobs
--     (available_boost_orders já trata coaching certo: preferred_booster_id
--     = auth.uid() sem checar prazo);
--   - accept_boost_order só bloqueia outro booster aceitar enquanto
--     exclusive_until > now() -- depois das 12h essa trava de RPC caía
--     também, sobrando só a view como proteção.
-- Fix: exclusive_until nunca é setado pra coaching (fica sempre null =
-- reserva permanente), e os dois pontos que liam exclusive_until pra decidir
-- exclusividade agora tratam service_type = 'coaching' como exclusivo
-- incondicional, independente de prazo.

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
  v_order record;
  v_exclusive_until timestamptz;
begin
  select id, customer_id, preferred_booster_id, service_type
  into v_order
  from public.orders
  where id = p_order_id and status = 'pending_review'
  for update;

  if not found then
    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null and v_order.service_type <> 'coaching'
      then now() + interval '12 hours'
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
  values (p_order_id, 'pending_review', 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

  if v_order.preferred_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.preferred_booster_id, 'exclusive_job', 'Pedido exclusivo para você!',
      'Um pedido foi reservado pra você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;
end;
$$;

revoke all on function public._release_pending_review_order(uuid, uuid, text) from public, anon, authenticated;

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

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and (
      v_order.service_type = 'coaching'
      or (v_order.exclusive_until is not null and v_order.exclusive_until > now())
    );

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

-- Bug 2: o cron discord-top3-announcement (job 9) tinha o x-webhook-secret
-- hardcoded em texto puro no comando do cron.schedule -- único job nesse
-- padrão desde que announce-expired-exclusive-jobs (job 11) foi corrigido
-- pra ler do vault. Valor real preservado, só movido pra
-- vault.decrypted_secrets (secret 'discord_top3_cron_secret', criado em
-- vault.create_secret nesta mesma sessão, extraído do cron.job.command
-- vigente -- nenhuma migration versionada chegou a conter o literal).
do $$
begin
  perform cron.unschedule('discord-top3-announcement');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'discord-top3-announcement',
    '0 12 15,30 * *',
    $cron$
    select net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-top3-announcement',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_top3_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
    $cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — discord-top3-announcement job not rescheduled';
end $$;
