-- W3 (2/2): liquidacao de pedido pago (analise -> reembolso/cancelamento calculado), reembolso <= valor pago,
-- webhook/pagamentos, saldo negativo e dashboard (H-07, H-08, H-09, H-10, H-11, H-14, H-16, M-19, M-20).
-- Regras (dono, 2026-10-08):
--  * cliente so cancela o PAGAMENTO antes de pagar; depois de pago so o admin trata (marca em analise e depois
--    reembolsa ou cancela);
--  * reembolso nunca passa do valor pago; o admin nunca digita valor;
--  * pedido em andamento: o booster recebe pelo progresso (preco vigente x progresso x share) e o admin
--    reembolsa o que faltava (valor pago ainda nao consumido x (1 - progresso));
--  * pedido sem booster: reembolso do valor pago ainda nao consumido.
set search_path = public, extensions;

-- ===== M-20: vocabulario unico de refunds.status =====
update public.refunds set status = 'succeeded' where status = 'completed';
alter table public.refunds add constraint refunds_status_check check (status in ('pending', 'succeeded', 'failed'));

-- ===== M-19 / RN-10: saque nos dias 15 e ultimo dia do mes (vale como dia 30) =====
create or replace function public.is_payout_window_day(p_at timestamptz default now())
 returns boolean language sql stable set search_path to 'public'
as $$
  select d.day = 15
      or d.day = extract(day from (date_trunc('month', d.local_date) + interval '1 month - 1 day'))::int
  from (select (p_at at time zone 'America/Sao_Paulo')::date as local_date,
               extract(day from (p_at at time zone 'America/Sao_Paulo'))::int as day) d
$$;
grant execute on function public.is_payout_window_day(timestamptz) to authenticated;

-- Top 3 e lembrete de saque rodam todo dia e so agem na janela (cron "15,30" pulava fevereiro e o dia 31).
select cron.unschedule('refresh-top3-boosters');
select cron.schedule('refresh-top3-boosters', '0 3 * * *',
  'select case when public.is_payout_window_day() then public.refresh_top3_boosters() end;');

-- ===== share do booster (coaching 70%, top 3 60%, demais 55%) =====
create or replace function public._booster_share_pct(p_user_id uuid, p_service_type public.service_type)
 returns numeric language sql stable security definer set search_path to 'public'
as $$
  select case
    when p_service_type = 'coaching' then 0.70
    when coalesce((select is_top3 from public.booster_profiles where user_id = p_user_id), false) then 0.60
    else 0.55
  end
$$;
revoke execute on function public._booster_share_pct(uuid, public.service_type) from public, anon, authenticated;

-- ===== valores da liquidacao (mesmos numeros para cliente, booster e admin) =====
create or replace function public._order_settlement_numbers(p_order_id uuid, p_coaching_pct numeric default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  o record;
  v_paid numeric; v_refunded numeric; v_remaining numeric;
  v_f numeric := 0; v_consumed numeric := 0; v_credit numeric := 0; v_share numeric := 0;
begin
  select id, status, customer_id, assigned_booster_id, service_type, total_price, amount_paid, settled_value, payment_status
    into o from public.orders where id = p_order_id;
  if not found then return null; end if;

  v_paid := coalesce(o.amount_paid, 0);
  select coalesce(sum(amount), 0) into v_refunded from public.refunds
   where order_id = p_order_id and status in ('pending', 'succeeded');
  v_remaining := greatest(0, v_paid - coalesce(o.settled_value, 0) - v_refunded);

  if o.assigned_booster_id is not null
     and o.status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'under_review', 'disputed') then
    v_f := coalesce(public._order_progress_fraction(p_order_id, p_coaching_pct), 0);
    v_consumed := least(round(o.total_price * v_f, 2), v_remaining);
    v_share := public._booster_share_pct(o.assigned_booster_id, o.service_type);
    v_credit := round(v_consumed * v_share, 2);
  end if;

  return jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'paid', v_paid, 'already_refunded', v_refunded,
    'settled_before', coalesce(o.settled_value, 0), 'remaining', v_remaining,
    'progress_pct', round(v_f * 100, 2), 'gross_consumed', v_consumed,
    'booster_id', o.assigned_booster_id, 'booster_share_pct', v_share, 'booster_credit', v_credit,
    'refund_amount', v_remaining - v_consumed, 'platform_retained', v_consumed - v_credit
  );
end;
$function$;
revoke execute on function public._order_settlement_numbers(uuid, numeric) from public, anon, authenticated;

create or replace function public.order_settlement_preview(p_order_id uuid, p_coaching_pct numeric default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.orders o
                 where o.id = p_order_id
                   and (public.is_admin() or o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())) then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  return jsonb_build_object('success', true) || public._order_settlement_numbers(p_order_id, p_coaching_pct);
end;
$function$;
grant execute on function public.order_settlement_preview(uuid, numeric) to authenticated;

-- ===== liquidacao: pedido em analise -> reembolso (calculado) ou cancelamento =====
create or replace function public._settle_order(p_order_id uuid, p_outcome text, p_reason text, p_coaching_pct numeric)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  o record;
  v_reason text := trim(p_reason);
  n jsonb;
  v_credit numeric; v_consumed numeric; v_refund numeric; v_booster uuid;
  v_payment_id uuid; v_refund_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if not public.check_own_write_rate_limit('admin_settle_order', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, status, customer_id, assigned_booster_id, payment_status into o
    from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if o.status <> 'under_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_under_review');
  end if;
  if o.payment_status <> 'paid' then
    return jsonb_build_object('success', false, 'error', 'order_not_paid');
  end if;

  n := public._order_settlement_numbers(p_order_id, p_coaching_pct);
  v_credit := (n->>'booster_credit')::numeric;
  v_consumed := (n->>'gross_consumed')::numeric;
  v_refund := (n->>'refund_amount')::numeric;
  v_booster := o.assigned_booster_id;

  if p_outcome = 'refund' and v_refund <= 0 then
    return jsonb_build_object('success', false, 'error', 'nothing_to_refund');
  end if;

  if v_booster is not null then
    if v_credit > 0 then
      perform 1 from public.booster_profiles where user_id = v_booster for update;
      update public.booster_profiles set total_earnings = total_earnings + v_credit where user_id = v_booster;
      insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role, metadata)
      values (v_booster, p_order_id, 'commission_credit', v_credit,
              'Pagamento pelo progresso entregue (' || (n->>'progress_pct') || '%) no pedido ' || p_order_id::text || ' encerrado pelo admin',
              auth.uid(), 'admin'::public.user_role, n);
    end if;
    insert into public.notifications(user_id, type, title, body, data)
    values (v_booster, 'order_status_changed', 'Pedido encerrado',
            'O pedido foi encerrado pela equipe.' ||
              case when v_credit > 0 then ' R$ ' || v_credit::text || ' foram creditados pelo progresso entregue.' else '' end,
            jsonb_build_object('order_id', p_order_id, 'amount', v_credit));
    update public.order_booster_assignments set unassigned_at = now()
     where order_id = p_order_id and unassigned_at is null;
    update public.duo_accounts set reserved_by = null, reserved_order_id = null, reserved_at = null
     where reserved_order_id = p_order_id;
  end if;

  update public.orders set
    assigned_booster_id = null, preferred_booster_id = null, exclusive_until = null, duo_own_riot_id = null,
    settled_value = settled_value + v_consumed,
    status = case when p_outcome = 'cancel' then 'canceled'::public.order_status else status end,
    updated_at = now()
  where id = p_order_id;

  if p_outcome = 'cancel' then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'under_review', 'canceled', auth.uid(), v_reason);
  else
    select id into v_payment_id from public.payments
     where order_id = p_order_id and status in ('paid', 'partially_refunded') order by created_at desc limit 1 for update;
    if v_payment_id is null then
      raise exception 'payment_not_found';
    end if;
    insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
    values (v_payment_id, p_order_id, 'manual-' || gen_random_uuid()::text, v_refund, v_reason, auth.uid(), 'pending', true)
    returning id into v_refund_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.settled_' || p_outcome, 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'numbers', n, 'refund_id', v_refund_id));

  insert into public.notifications(user_id, type, title, body, data)
  values (o.customer_id, 'order_status_changed',
          case when p_outcome = 'cancel' then 'Pedido cancelado' else 'Reembolso em processamento' end,
          case when p_outcome = 'cancel' then 'Seu pedido foi cancelado pela nossa equipe.'
               else 'Seu reembolso de R$ ' || v_refund::text || ' foi aprovado e será devolvido a você.' end,
          jsonb_build_object('order_id', p_order_id, 'refund_amount', v_refund));

  return jsonb_build_object('success', true, 'refund_id', v_refund_id) || n;
end;
$function$;
revoke execute on function public._settle_order(uuid, text, text, numeric) from public, anon, authenticated;

-- Substitui o reembolso manual com valor digitado (RN-04): a assinatura antiga e removida.
drop function public.admin_create_manual_refund(uuid, text, numeric);
create function public.admin_create_manual_refund(p_order_id uuid, p_reason text, p_coaching_pct numeric default null)
 returns jsonb language sql security definer set search_path to 'public'
as $$ select public._settle_order(p_order_id, 'refund', p_reason, p_coaching_pct) $$;
create function public.admin_cancel_paid_order(p_order_id uuid, p_reason text, p_coaching_pct numeric default null)
 returns jsonb language sql security definer set search_path to 'public'
as $$ select public._settle_order(p_order_id, 'cancel', p_reason, p_coaching_pct) $$;
revoke execute on function public.admin_create_manual_refund(uuid, text, numeric) from public, anon;
revoke execute on function public.admin_cancel_paid_order(uuid, text, numeric) from public, anon;
grant execute on function public.admin_create_manual_refund(uuid, text, numeric) to authenticated;
grant execute on function public.admin_cancel_paid_order(uuid, text, numeric) to authenticated;

-- ===== confirmacao do reembolso: atualiza pagamento e pedido de forma consistente =====
create or replace function public.admin_confirm_manual_refund(p_refund_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_refund public.refunds%rowtype;
  v_order  record;
  v_pay    record;
  v_new_refunded numeric;
  v_pay_status public.payment_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  -- Mesma ordem de lock do webhook e da criacao: pedido, pagamento, reembolso.
  select id, status, customer_id into v_order from public.orders where id = v_refund.order_id for update;
  select id, amount, coalesce(refunded_amount, 0) as refunded_amount into v_pay
    from public.payments where id = v_refund.payment_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;
  v_new_refunded := v_pay.refunded_amount + v_refund.amount;
  if v_new_refunded > v_pay.amount then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  update public.refunds set status = 'succeeded' where id = v_refund.id;

  v_pay_status := case when v_new_refunded >= v_pay.amount then 'refunded' else 'partially_refunded' end;
  update public.payments set refunded_amount = v_new_refunded, status = v_pay_status, updated_at = now()
   where id = v_pay.id;

  -- O webhook do Mercado Pago pode ter reembolsado o pedido no meio tempo.
  if v_order.status <> 'refunded' then
    update public.orders set status = 'refunded'::public.order_status, payment_status = v_pay_status, updated_at = now()
     where id = v_order.id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_order.id, v_order.status, 'refunded'::public.order_status, auth.uid(),
            'Reembolso confirmado: ' || v_refund.reason);
  else
    update public.orders set payment_status = v_pay_status, updated_at = now() where id = v_order.id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_confirmed', 'order', v_order.id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount, 'payment_status', v_pay_status));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_status_changed', 'Reembolso processado',
            'R$ ' || v_refund.amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_refund.reason,
            jsonb_build_object('order_id', v_order.id, 'amount', v_refund.amount));
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$;

-- ===== H-08: estorno de comissao unico (webhook), vale em qualquer status do pedido =====
create or replace function public._clawback_order_commissions(p_order_id uuid, p_provider_status text, p_mp_payment_id text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_credit record;
begin
  for v_credit in
    select booster_id, coalesce(sum(amount), 0) as net
    from public.booster_ledger_entries
    where order_id = p_order_id and entry_type in ('commission_credit', 'commission_adjustment', 'refund_debit')
    group by booster_id
    having coalesce(sum(amount), 0) > 0
  loop
    perform 1 from public.booster_profiles where user_id = v_credit.booster_id for update;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, metadata)
    values (v_credit.booster_id, p_order_id, 'refund_debit', -v_credit.net,
            case when p_provider_status = 'refunded'
              then 'Estorno da comissao -- pedido reembolsado pelo Mercado Pago'
              else 'Estorno da comissao -- chargeback recebido pelo Mercado Pago' end,
            jsonb_build_object('mp_payment_id', p_mp_payment_id, 'provider_status', p_provider_status));

    update public.booster_profiles set total_earnings = total_earnings - v_credit.net where user_id = v_credit.booster_id;

    insert into public.notifications(user_id, type, title, body, data)
    values (v_credit.booster_id, 'commission_clawed_back', 'Comissão estornada',
            case when p_provider_status = 'refunded'
              then 'O cliente foi reembolsado pelo Mercado Pago. A comissão de R$ ' || v_credit.net::text || ' foi estornada do seu saldo.'
              else 'Houve um chargeback no Mercado Pago. A comissão de R$ ' || v_credit.net::text || ' foi estornada do seu saldo.' end,
            jsonb_build_object('order_id', p_order_id, 'amount', v_credit.net));

    insert into public.notifications(user_id, type, title, body, data)
    select id, 'commission_clawed_back_admin', 'Estorno de comissão',
           'Pedido ' || p_order_id::text || ' foi ' || (case when p_provider_status = 'refunded' then 'reembolsado' else 'contestado (chargeback)' end)
             || '. R$ ' || v_credit.net::text || ' foram estornados do saldo do booster -- confirme se já houve saque desse valor.',
           jsonb_build_object('order_id', p_order_id, 'booster_id', v_credit.booster_id, 'amount', v_credit.net)
    from public.profiles where role = 'admin';
  end loop;
end;
$function$;
revoke execute on function public._clawback_order_commissions(uuid, text, text) from public, anon, authenticated;

-- ===== H-14: saldo negativo e permitido; admin e avisado =====
create or replace function public.trg_fn_alert_negative_balance()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_balance numeric;
begin
  if new.amount >= 0 then return new; end if;
  select coalesce(sum(amount), 0) into v_balance from public.booster_ledger_entries where booster_id = new.booster_id;
  if v_balance < 0 and not exists (
       select 1 from public.notifications n
       where n.type = 'booster_negative_balance' and not n.is_read and (n.data->>'booster_id')::uuid = new.booster_id) then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'booster_negative_balance', 'Booster com saldo negativo',
           'Um booster ficou com saldo negativo (R$ ' || v_balance::text || ') por penalidade ou estorno. Saque bloqueado até regularizar.',
           jsonb_build_object('booster_id', new.booster_id, 'balance', v_balance)
    from public.profiles where role = 'admin';
  end if;
  return new;
end;
$function$;
revoke execute on function public.trg_fn_alert_negative_balance() from public, anon, authenticated;
create trigger trg_ledger_alert_negative_balance after insert on public.booster_ledger_entries
  for each row execute function public.trg_fn_alert_negative_balance();

-- ===== funcoes atualizadas (webhook, flag, pagamento, expiracao, saldo, dashboard, saque) =====
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
      else v_payment_status
    end,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_order.status = 'canceled'
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

  if p_provider_status = 'approved' and v_order.status = 'awaiting_payment' then
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

CREATE OR REPLACE FUNCTION public.admin_flag_order_under_review(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_from_status public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_from_status := v_order.status;

  if v_order.assigned_booster_id is not null then
    update public.orders
    set status                    = 'under_review',
        under_review_from_status  = v_from_status,
        under_review_started_at   = now(),
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido entrou em análise manual da nossa equipe -- fica travado (sem novas partidas contabilizadas) até liberarmos de novo. Entraremos em contato pelo chat do pedido se precisarmos de mais informações.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido seu foi colocado em análise pela equipe -- sync de partidas e acesso à conta ficam pausados até liberarmos de novo. Você continua responsável por ele.',
      jsonb_build_object('order_id', p_order_id)
    );

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'from_status', v_from_status, 'booster_preserved', true));

    return jsonb_build_object('success', true);
  end if;

  update public.orders
  set status               = 'under_review',
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido em análise',
      'Seu pedido entrou em análise manual pela nossa equipe. Se precisarmos de mais informações, falaremos com você pelo chat do pedido.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'from_status', v_from_status));

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_pix_payment(p_order_id uuid, p_customer_id uuid, p_mp_payment_id text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> p_customer_id then raise exception 'order mismatch'; end if;
  if v_order.status <> 'awaiting_payment' then raise exception 'order not payable'; end if;
  if round(v_order.total_price, 2) <> round(p_amount, 2) or p_amount <= 0 then raise exception 'amount mismatch'; end if;
  if v_order.mp_payment_id is not null and v_order.mp_payment_id <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  select mp_payment_id into v_existing from public.payments where order_id = p_order_id for update;
  if found and v_existing <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  update public.orders set mp_payment_id = p_mp_payment_id, updated_at = now() where id = p_order_id;
  insert into public.payments(order_id, customer_id, mp_payment_id, amount, currency, status, metadata)
  values (p_order_id, p_customer_id, p_mp_payment_id, round(p_amount, 2), 'brl', 'pending',
          jsonb_build_object('provider', 'mercadopago', 'mp_payment_id', p_mp_payment_id))
  on conflict (order_id) do update set updated_at = now();

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_pix_orders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- PIX gerado e nao pago em 35 min.
  with expired as (
    update public.orders o
    set status = 'canceled', updated_at = now()
    where o.status = 'awaiting_payment'
      and o.mp_payment_id is not null
      and exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and p.mp_payment_id = o.mp_payment_id
          and p.status = 'pending'
          and coalesce(p.metadata->>'method', 'pix') = 'pix'
          and p.created_at < now() - interval '35 minutes'
      )
    returning o.id, o.customer_id
  ), failed as (
    update public.payments p set status = 'failed', updated_at = now()
    where p.order_id in (select id from expired) and p.status = 'pending'
  )
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  select id, 'awaiting_payment', 'canceled', customer_id, 'PIX expirado sem confirmação de pagamento'
  from expired;

  -- H-11: pedido salvo e nunca pago (sem cobranca) expira em 24 h e libera os tetos de pedidos pendentes.
  with abandoned as (
    update public.orders o
    set status = 'canceled', updated_at = now()
    where o.status = 'awaiting_payment'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.payments p where p.order_id = o.id and p.status in ('pending', 'paid'))
    returning o.id, o.customer_id
  )
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  select id, 'awaiting_payment', 'canceled', customer_id, 'Pedido não pago expirou após 24 horas'
  from abandoned;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_booster_balance(p_booster_id uuid, p_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 or p_amount <> round(p_amount, 2) then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if not public.check_own_write_rate_limit('admin_adjust_booster_balance', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform 1 from public.booster_profiles where user_id = p_booster_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  insert into public.booster_ledger_entries(booster_id, entry_type, amount, description, actor_id, actor_role)
  values (p_booster_id, 'manual_admin_adjustment', p_amount, v_reason, auth.uid(), 'admin'::public.user_role);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'booster.manual_balance_adjustment', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_booster_id, 'order_status_changed', 'Ajuste de saldo',
    (case when p_amount > 0 then 'R$ ' || p_amount::text || ' foi creditado ao seu saldo pela administração.'
          else 'R$ ' || abs(p_amount)::text || ' foi descontado do seu saldo pela administração.' end)
      || ' Motivo: ' || v_reason,
    jsonb_build_object('amount', p_amount)
  );

  return jsonb_build_object('success', true, 'new_balance', public.booster_available_balance(p_booster_id));
end;
$function$;

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
  from public.orders where status in ('assigned', 'in_progress', 'paused');

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
$function$;

CREATE OR REPLACE FUNCTION public.request_payout(p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
  v_min_amount constant numeric := 50.00;
begin
  if not public.check_own_write_rate_limit('request_payout', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if p_amount < v_min_amount then
    return jsonb_build_object('success', false, 'error', 'below_minimum_amount', 'minimum', v_min_amount);
  end if;

  if not public.is_payout_window_day() then
    return jsonb_build_object('success', false, 'error', 'withdrawal_window_closed');
  end if;

  -- Serializa solicitações concorrentes do mesmo booster (evita duas
  -- requisições simultâneas passarem ambas no cheque de saldo antes de
  -- qualquer uma commitar).
  select * into v_booster from public.booster_profiles where user_id = auth.uid() for update;
  if v_booster is null or v_booster.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;

  v_available := public.booster_available_balance(auth.uid());
  if v_available < 0 then
    return jsonb_build_object('success', false, 'error', 'negative_balance', 'available', v_available);
  end if;
  if p_amount > v_available then
    return jsonb_build_object('success', false, 'error', 'insufficient_balance', 'available', v_available);
  end if;

  insert into public.payout_requests(
    booster_id, amount, booster_cpf_snapshot, booster_legal_name_snapshot
  ) values (
    auth.uid(), p_amount, v_booster.cpf, v_booster.full_name
  )
  returning id into v_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    auth.uid(), v_request_id, 'payout_reservation', -p_amount,
    'Reserva para solicitação de saque ' || v_request_id::text, auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.created', 'payout_request', v_request_id::text,
          jsonb_build_object('amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'payout_request_created', 'Nova solicitação de saque',
         'Um booster solicitou saque de R$ ' || p_amount::text,
         jsonb_build_object('payout_request_id', v_request_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true, 'request_id', v_request_id);
end;
$function$;
