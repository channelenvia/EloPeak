-- W-6: coaching/admin/chat.
-- H-13 teto de 3 pacotes de coaching e total por booster (nao por service_type); M-15 DM de mencao saia em dobro;
-- M-19 display_name de booster com charset/limite (entra em embeds do Discord); M-23 KPI de pedidos ativos completo.
-- Mesmas assinaturas (CREATE OR REPLACE) -- sem overload orfao.
set search_path = public, extensions;

-- ===== H-13 =====
CREATE OR REPLACE FUNCTION public.trg_fn_cap_coach_packages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  -- Fila por booster: duas criacoes simultaneas nao passam juntas pelo teto de 3.
  perform pg_advisory_xact_lock(hashtextextended('booster_services:' || new.booster_id::text, 0));

  -- UPDATE so conta quando o pacote passa a ocupar uma vaga (reativar da lixeira). Trocar service_type de pacote ja
  -- ativo nao muda o total, que e por booster e nao por tipo (H-13).
  if tg_op = 'UPDATE' and (new.deleted_at is not null or old.deleted_at is null) then
    return new;
  end if;

  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id
    and deleted_at is null
    and id <> new.id;

  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$function$
;

-- ===== M-15 =====
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

    -- M-15: a DM sai pelo trigger trg_notify_discord_chat_mention (INSERT em notifications); chamar a edge aqui duplicava.
  end loop;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$function$
;

-- ===== M-19 =====
CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_current_name text;
  v_days_remaining integer;
begin
  if not public.check_own_write_rate_limit('update_my_display_name', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select display_name into v_current_name from public.booster_profiles where user_id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_display_name is distinct from v_current_name
     and (char_length(v_display_name) > 32 or v_display_name !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$') then
    return jsonb_build_object('success', false, 'error', 'display_name_invalid');
  end if;

  if v_display_name is distinct from v_current_name then
    if exists (
      select 1 from public.booster_profiles
      where lower(display_name) = lower(v_display_name) and user_id <> auth.uid()
    ) then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;

    v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
    if v_days_remaining > 0 then
      return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
    end if;
  end if;

  update public.booster_profiles set display_name = v_display_name where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$
;

-- ===== M-19 =====
CREATE OR REPLACE FUNCTION public.onboard_booster(p_display_name text, p_bio text, p_peak_rank jsonb, p_opgg_link text DEFAULT NULL::text, p_hours_per_day_min integer DEFAULT NULL::integer, p_hours_per_day_max integer DEFAULT NULL::integer, p_full_name text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text, p_available_days text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role;
  v_email     text;
  v_bio       text := nullif(btrim(p_bio), '');
  v_opgg      text := nullif(btrim(p_opgg_link), '');
  v_full_name text := nullif(btrim(p_full_name), '');
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_tier      text := p_peak_rank->>'tier';
  v_booster_id uuid;
  v_is_new_application boolean;
begin
  if not public.check_own_write_rate_limit('onboard_booster', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  v_is_new_application := not exists(select 1 from public.booster_profiles where user_id = auth.uid() and status <> 'rejected');

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  if nullif(btrim(p_display_name), '') is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if char_length(btrim(p_display_name)) > 32 or btrim(p_display_name) !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$' then
    return jsonb_build_object('success', false, 'error', 'display_name_invalid');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if char_length(v_bio) > 256 then
    return jsonb_build_object('success', false, 'error', 'bio_too_long');
  end if;
  if v_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;
  if v_full_name is null then
    return jsonb_build_object('success', false, 'error', 'full_name_required');
  end if;
  if not public.is_valid_cpf(v_cpf_digits) then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  begin
    insert into public.booster_profiles(
      user_id, display_name, bio, status,
      peak_rank, opgg_link, hours_per_day_min, hours_per_day_max,
      full_name, email, cpf, available_days
    )
    values (
      auth.uid(), btrim(p_display_name), v_bio, 'pending',
      p_peak_rank, v_opgg, p_hours_per_day_min, p_hours_per_day_max,
      v_full_name, v_email, v_cpf_digits, p_available_days
    )
    on conflict (user_id) do update set
      display_name      = excluded.display_name,
      bio               = excluded.bio,
      peak_rank         = excluded.peak_rank,
      opgg_link         = excluded.opgg_link,
      hours_per_day_min = excluded.hours_per_day_min,
      hours_per_day_max = excluded.hours_per_day_max,
      full_name         = excluded.full_name,
      email             = excluded.email,
      cpf               = excluded.cpf,
      available_days    = excluded.available_days,
      status            = case when booster_profiles.status = 'rejected' then 'pending' else booster_profiles.status end,
      updated_at        = now()
    where booster_profiles.status in ('pending', 'rejected')
    returning id into v_booster_id;
  exception when unique_violation then
    if sqlerrm like '%display_name%' then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;
    return jsonb_build_object('success', false, 'error', 'cpf_taken');
  end;

  if v_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'application_not_editable');
  end if;

  if v_is_new_application then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'booster_pending_review', 'Novo booster pendente',
      btrim(p_display_name) || ' se candidatou como booster e está aguardando aprovação.',
      jsonb_build_object('booster_id', v_booster_id)
    from public.profiles where role = 'admin';

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-booster-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('booster_id', v_booster_id, 'display_name', btrim(p_display_name)),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$
;

-- ===== M-23 =====
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_revenue numeric;
  v_total_payouts numeric;
  v_active_orders integer;
  v_pending_boosters integer;
  v_recent_orders jsonb;
  v_daily_orders jsonb;
begin
  if not public.is_admin() then
    raise exception 'unauthorized';
  end if;

  -- Receita = pago - reembolsos efetivados (fonte: payments/refunds).
  select coalesce((select sum(amount) from public.payments
                    where status in ('paid', 'partially_refunded', 'refunded', 'disputed')), 0)
       - coalesce((select sum(amount) from public.refunds where status = 'succeeded'), 0)
    into v_total_revenue;

  -- Repasses = ledger dos boosters (creditos - penalidades/estornos), fonte unica de saldo.
  select coalesce(sum(amount), 0) into v_total_payouts
  from public.booster_ledger_entries
  where entry_type in ('commission_credit', 'commission_adjustment', 'drop_penalty', 'refund_debit', 'manual_admin_adjustment');

  select count(*) into v_active_orders
  from public.orders where status in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'under_review', 'disputed');

  select count(*) into v_pending_boosters
  from public.booster_profiles where status in ('pending', 'under_review');

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_recent_orders from (
    select id, status, total_price, created_at
    from public.orders
    where status not in ('awaiting_payment', 'canceled')
    order by created_at desc
    limit 8
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_daily_orders from (
    select gs::date as day, count(o.id) as count
    from generate_series((now() at time zone 'America/Sao_Paulo')::date - 6, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') gs
    left join public.orders o
      on (o.created_at at time zone 'America/Sao_Paulo')::date = gs::date
      and o.status not in ('awaiting_payment', 'canceled')
    group by gs
    order by gs
  ) t;

  return jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_payouts', v_total_payouts,
    'platform_profit', v_total_revenue - v_total_payouts,
    'active_orders_count', v_active_orders,
    'pending_boosters_count', v_pending_boosters,
    'recent_orders', v_recent_orders,
    'daily_orders', v_daily_orders
  );
end;
$function$
;

-- ===== M-19 (perfil profissional) =====
CREATE OR REPLACE FUNCTION public.update_booster_professional_profile(p_display_name text, p_bio text, p_peak_tier text, p_opgg_link text, p_opgg_link_visible boolean, p_available_days text[], p_hours_per_day_min integer, p_hours_per_day_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_bio          text := nullif(btrim(p_bio), '');
  v_opgg         text := nullif(btrim(p_opgg_link), '');
  v_current      record;
  v_days_remaining integer;
begin
  if not public.check_own_write_rate_limit('update_booster_professional_profile', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select display_name, display_name_changed_at into v_current
  from public.booster_profiles where user_id = auth.uid();

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;

  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if p_peak_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  if v_display_name is distinct from v_current.display_name then
    -- M-19: o nome entra em embeds do Discord; so valida quando muda (nome legado pode ser reenviado).
    if char_length(v_display_name) > 32 or v_display_name !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$' then
      return jsonb_build_object('success', false, 'error', 'display_name_invalid');
    end if;
    if exists (
      select 1 from public.booster_profiles
      where lower(display_name) = lower(v_display_name) and user_id <> auth.uid()
    ) then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;

    v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
    if v_days_remaining > 0 then
      return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
    end if;
  end if;

  update public.booster_profiles
  set display_name       = v_display_name,
      bio                = v_bio,
      peak_rank          = jsonb_build_object('tier', p_peak_tier, 'division', null),
      opgg_link          = v_opgg,
      opgg_link_visible  = coalesce(p_opgg_link_visible, true),
      available_days     = p_available_days,
      hours_per_day_min  = p_hours_per_day_min,
      hours_per_day_max  = p_hours_per_day_max,
      updated_at         = now()
  where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$
;
