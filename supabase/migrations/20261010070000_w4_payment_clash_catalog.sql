-- W-4: pagamento/Clash/catalogo.
-- H-5 reabertura paga de Clash nao e barrada pelo teto; M-12 seed dos catalogos de preco (DO NOTHING: preserva ajustes de producao);
-- M-14 lembretes de Top 3/saque rodam todo dia e so agem na janela (15 e ultimo dia do mes).
set search_path = public, extensions;

-- ===== M-12: seed dos catalogos =====
INSERT INTO public.win_price_cents_catalog (queue_type, boost_mode, tier, price_cents) VALUES
  ('solo_duo', 'duo', 'bronze', 605),
  ('solo_duo', 'duo', 'challenger', 21090),
  ('solo_duo', 'duo', 'diamond', 2995),
  ('solo_duo', 'duo', 'emerald', 2005),
  ('solo_duo', 'duo', 'gold', 929),
  ('solo_duo', 'duo', 'grandmaster', 12590),
  ('solo_duo', 'duo', 'iron', 605),
  ('solo_duo', 'duo', 'master', 8515),
  ('solo_duo', 'duo', 'platinum', 1085),
  ('solo_duo', 'duo', 'silver', 795),
  ('solo_duo', 'solo', 'bronze', 458),
  ('solo_duo', 'solo', 'challenger', 14440),
  ('solo_duo', 'solo', 'diamond', 1685),
  ('solo_duo', 'solo', 'emerald', 1315),
  ('solo_duo', 'solo', 'gold', 567),
  ('solo_duo', 'solo', 'grandmaster', 8620),
  ('solo_duo', 'solo', 'iron', 458),
  ('solo_duo', 'solo', 'master', 5830),
  ('solo_duo', 'solo', 'platinum', 930),
  ('solo_duo', 'solo', 'silver', 479),
  ('flex', 'duo', 'bronze', 605),
  ('flex', 'duo', 'challenger', 21090),
  ('flex', 'duo', 'diamond', 2995),
  ('flex', 'duo', 'emerald', 2005),
  ('flex', 'duo', 'gold', 929),
  ('flex', 'duo', 'grandmaster', 12590),
  ('flex', 'duo', 'iron', 605),
  ('flex', 'duo', 'master', 8515),
  ('flex', 'duo', 'platinum', 1085),
  ('flex', 'duo', 'silver', 795),
  ('flex', 'solo', 'bronze', 458),
  ('flex', 'solo', 'challenger', 14440),
  ('flex', 'solo', 'diamond', 1685),
  ('flex', 'solo', 'emerald', 1315),
  ('flex', 'solo', 'gold', 567),
  ('flex', 'solo', 'grandmaster', 8620),
  ('flex', 'solo', 'iron', 458),
  ('flex', 'solo', 'master', 5830),
  ('flex', 'solo', 'platinum', 930),
  ('flex', 'solo', 'silver', 479)
ON CONFLICT (queue_type, boost_mode, tier) DO NOTHING;

INSERT INTO public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, boost_mode, price) VALUES
  ('grandmaster', 'challenger', 'solo_duo', 0, 'solo', 1698.87),
  ('grandmaster', 'challenger', 'flex', 0, 'duo', 3280.90),
  ('grandmaster', 'challenger', 'flex', 0, 'solo', 1698.87),
  ('master', 'challenger', 'solo_duo', 0, 'solo', 2918.04),
  ('master', 'challenger', 'flex', 0, 'duo', 5430.90),
  ('master', 'challenger', 'flex', 0, 'solo', 2918.04),
  ('master', 'grandmaster', 'solo_duo', 0, 'solo', 1219.17),
  ('master', 'grandmaster', 'flex', 0, 'duo', 2150.90),
  ('master', 'grandmaster', 'flex', 0, 'solo', 1219.17)
ON CONFLICT (current_tier, target_tier, queue_type, pdl_from, boost_mode) DO NOTHING;

-- ===== H-5 =====
CREATE OR REPLACE FUNCTION public.trg_fn_cap_active_clash_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing boolean;
begin
  -- Em UPDATE so vale quando o pedido passa a ser um Clash ativo (reativar/trocar dono/tipo).
  -- H-5: o teto vale quando o pedido PASSA a ser um Clash ativo. Pedido que ja era ativo (ex.: awaiting_payment ->
  -- awaiting_assignment ao aprovar o pagamento) nao e rechecado, e a reabertura por pagamento aprovado depois do
  -- cancelamento (canceled -> awaiting_payment) nunca e barrada: o dinheiro ja foi capturado.
  if tg_op = 'UPDATE' and old.service_type = 'clash' and old.customer_id is not distinct from new.customer_id and (
       old.status not in ('completed', 'canceled', 'refunded')
       or (old.status = 'canceled' and new.status = 'awaiting_payment')
     ) then
    return new;
  end if;

  if new.service_type = 'clash' and new.status not in ('completed', 'canceled', 'refunded') then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 2));

    select exists (
      select 1 from public.orders
      where customer_id = new.customer_id
        and service_type = 'clash'
        and status not in ('completed', 'canceled', 'refunded')
        and id <> new.id
    ) into v_existing;

    if v_existing then
      raise exception 'active_clash_order_exists' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

-- ===== M-14: so agem na janela de saque =====
do $cron$
declare
  v_job record;
begin
  if to_regclass('cron.job') is null then return; end if;
  for v_job in
    select jobid, command from cron.job
     where jobname in ('discord-top3-announcement', 'discord-payout-window-reminder')
       and command not like '%is_payout_window_day%'
  loop
    perform cron.alter_job(
      v_job.jobid,
      schedule := '0 12 * * *',
      command := 'select case when public.is_payout_window_day() then (' ||
                 regexp_replace(regexp_replace(v_job.command, '^\s*select\s+', ''), ';\s*$', '') || ') end;'
    );
  end loop;
end
$cron$;

-- ===== L-5 =====
CREATE OR REPLACE FUNCTION public.process_mp_payment_event(p_order_id uuid, p_mp_payment_id text, p_provider_status text, p_amount numeric, p_currency text, p_event_id text, p_refund_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_payment_status public.payment_status;
  v_to_status public.order_status;
  v_requires_credentials boolean;
begin
  if p_provider_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back') then
    return jsonb_build_object('success', true, 'ignored', true);
  end if;

  select * into v_order from public.orders
  where id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_order_mismatch'); end if;

  select * into v_payment from public.payments
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_not_found'); end if;

  if p_event_id is not null and v_payment.webhook_event_id = p_event_id then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;

  if lower(p_currency) <> 'brl' or round(p_amount, 2) <> round(v_payment.amount, 2) then
    if not exists (
      select 1 from public.notifications
      where type = 'payment_amount_mismatch' and (data->>'order_id')::uuid = p_order_id
    ) then
      insert into public.notifications(user_id, type, title, body, data)
      select id, 'payment_amount_mismatch',
        'Pagamento com valor divergente',
        'Pedido ' || p_order_id::text || ' recebeu um pagamento MP de ' || p_currency || ' ' || p_amount::text
          || ', mas o valor esperado (registrado no pagamento) é R$ ' || v_payment.amount::text
          || '. O pedido está travado em aguardando pagamento até isso ser resolvido manualmente.',
        jsonb_build_object(
          'order_id', p_order_id, 'mp_payment_id', p_mp_payment_id,
          'expected_amount', v_payment.amount, 'received_amount', p_amount, 'received_currency', p_currency
        )
      from public.profiles where role = 'admin';
    end if;

    return jsonb_build_object('success', false, 'error', 'payment_reconciliation_failed');
  end if;

  v_payment_status := case
    when p_provider_status = 'approved' then 'paid'::public.payment_status
    when p_provider_status in ('rejected','cancelled') then 'failed'::public.payment_status
    when p_provider_status = 'refunded' then 'refunded'::public.payment_status
    when p_provider_status = 'charged_back' then 'disputed'::public.payment_status
    else 'pending'::public.payment_status
  end;

  update public.payments set
    status = case
      when v_payment.status in ('paid', 'refunded', 'partially_refunded', 'disputed')
           and v_payment_status in ('pending', 'failed') then v_payment.status
      -- L-5: webhook 'approved' tardio nao desfaz um reembolso (total ou parcial) ja registrado.
      when v_payment.status in ('refunded', 'partially_refunded') and v_payment_status = 'paid' then v_payment.status
      else v_payment_status
    end,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_payment.status not in ('refunded', 'partially_refunded', 'disputed') and v_order.status = 'canceled'
     and v_order.assigned_booster_id is null and v_order.payment_status is distinct from 'paid' then
    -- Pagamento aprovado depois de o pedido ser cancelado (PIX expirado/cancelado pelo cliente): o cliente
    -- pagou, entao o pedido volta ao fluxo normal em vez de ficar cancelado e pago.
    update public.orders set status = 'awaiting_payment', updated_at = now() where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'canceled', 'awaiting_payment', v_order.customer_id,
            'Pagamento aprovado apos o cancelamento -- pedido reaberto');
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'payment_approved_after_cancellation', 'Pagamento aprovado em pedido cancelado',
           'Pedido ' || p_order_id::text || ' foi cancelado, mas o pagamento foi aprovado depois. O pedido foi reaberto.',
           jsonb_build_object('order_id', p_order_id)
    from public.profiles where role = 'admin';
    v_order.status := 'awaiting_payment';
  end if;

  if p_provider_status = 'approved' and v_payment.status not in ('refunded', 'partially_refunded', 'disputed') and v_order.status = 'awaiting_payment' then
    v_requires_credentials := public.order_requires_access_token(v_order.service_type, v_order.boost_mode);
    v_to_status := case
      when v_requires_credentials then 'awaiting_customer'::public.order_status
      else 'pending_review'::public.order_status
    end;

    update public.orders set
      status = v_to_status,
      payment_status = 'paid',
      review_release_at = case when not v_requires_credentials then now() + interval '2 minutes' else null end,
      updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, 'awaiting_payment', v_to_status, v_order.customer_id,
      case when v_requires_credentials
        then 'Pagamento PIX confirmado; aguardando credenciais do cliente'
        else 'Pagamento PIX confirmado via Mercado Pago; em revisão administrativa antes de ir pro pool'
      end
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'payment_confirmed',
      'PIX confirmado!',
      case when v_requires_credentials
        then 'Pagamento aprovado. Envie as credenciais para liberar o pedido aos boosters.'
        else 'Pagamento aprovado! Seu pedido está sendo processado e logo estará disponível para os boosters.'
      end,
      jsonb_build_object('order_id', p_order_id, 'requires_credentials', v_requires_credentials)
    );

    -- Alerta pro admin só no caminho que entra direto em pending_review (sem
    -- credenciais pendentes) -- o outro caminho (awaiting_customer) só vira
    -- pending_review depois que o cliente manda as credenciais, tratado por
    -- release_paid_order_after_credentials logo abaixo.
    if not v_requires_credentials then
      insert into public.notifications(user_id, type, title, body, data)
      select id, 'order_pending_review', 'Novo pedido pago -- em revisão',
        'Pedido ' || p_order_id::text || ' foi pago e está na janela de revisão. Disponibilize, analise, atribua ou cancele.',
        jsonb_build_object('order_id', p_order_id)
      from public.profiles where role = 'admin';

      perform net.http_post(
        url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-review-alert',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
          'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
        ),
        body := jsonb_build_object('order_id', p_order_id),
        timeout_milliseconds := 10000
      );
    end if;
  elsif p_provider_status in ('rejected','cancelled') and v_order.status = 'awaiting_payment' then
    update public.orders set
      status = 'canceled',
      payment_status = v_payment_status,
      updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, 'awaiting_payment', 'canceled', v_order.customer_id,
      case when p_provider_status = 'rejected'
        then 'Pagamento PIX recusado pelo Mercado Pago'
        else 'Pagamento PIX cancelado pelo Mercado Pago'
      end
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'order_status_changed',
      'Pagamento não concluído',
      'O pagamento deste pedido não foi concluído (' ||
        (case when p_provider_status = 'rejected' then 'recusado' else 'cancelado' end) ||
        ' pelo Mercado Pago). O pedido foi cancelado -- configure um novo pedido para tentar novamente.',
      jsonb_build_object('order_id', p_order_id)
    );
  elsif p_provider_status in ('refunded','charged_back')
        and v_order.status not in ('refunded','disputed') then
    v_to_status := case
      when p_provider_status = 'refunded' then 'refunded'::public.order_status
      else 'disputed'::public.order_status
    end;
    update public.orders set status = v_to_status, payment_status = v_payment_status, updated_at = now()
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, v_to_status, v_order.customer_id,
      case when p_provider_status = 'refunded'
        then 'Pagamento reembolsado via Mercado Pago'
        else 'Chargeback recebido via Mercado Pago'
      end
    );
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'order_status_changed',
      case when p_provider_status = 'refunded' then 'Pedido reembolsado' else 'Pagamento contestado' end,
      case when p_provider_status = 'refunded' then 'Seu pedido foi reembolsado.' else 'Seu pagamento está em disputa.' end,
      jsonb_build_object('order_id', p_order_id)
    );
    if p_provider_status = 'refunded' then
      insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status)
      values (
        v_payment.id, p_order_id, coalesce(p_refund_id, p_mp_payment_id || '-refund'),
        v_payment.amount, 'Reembolso processado pelo Mercado Pago', v_order.customer_id, 'succeeded'
      )
      on conflict (mp_refund_id) do nothing;
    end if;

    perform public._clawback_order_commissions(p_order_id, p_provider_status, p_mp_payment_id);
    update public.order_booster_assignments set unassigned_at = now()
     where order_id = p_order_id and unassigned_at is null;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;
