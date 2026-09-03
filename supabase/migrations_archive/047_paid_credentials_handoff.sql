-- Keep the paid-order handoff authoritative in the database:
--   * Solo Boost, Win Boost and MD5 wait for customer credentials.
--   * Duo and services that do not need account access enter the booster pool.
--   * Submitting credentials releases the paid order to the booster pool.

create or replace function public.process_mp_payment_event(
  p_order_id uuid,
  p_mp_payment_id text,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_event_id text,
  p_refund_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  if lower(p_currency) <> 'brl' or round(p_amount, 2) <> round(v_order.total_price, 2) then
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
    status = v_payment_status,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_order.status = 'awaiting_payment' then
    v_requires_credentials := public.order_requires_access_token(v_order.service_type, v_order.boost_mode);
    v_to_status := case
      when v_requires_credentials then 'awaiting_customer'::public.order_status
      else 'awaiting_assignment'::public.order_status
    end;

    update public.orders set
      status = v_to_status,
      payment_status = 'paid',
      exclusive_until = case
        when not v_requires_credentials and v_order.preferred_booster_id is not null
          then now() + interval '3 hours'
        else null
      end,
      updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, 'awaiting_payment', v_to_status, v_order.customer_id,
      case when v_requires_credentials
        then 'Pagamento PIX confirmado; aguardando credenciais do cliente'
        else 'Pagamento PIX confirmado via Mercado Pago'
      end
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'payment_confirmed',
      'PIX confirmado!',
      case when v_requires_credentials
        then 'Pagamento aprovado. Envie as credenciais para liberar o pedido aos boosters.'
        else 'Seu pedido foi pago e está na fila de boosters.'
      end,
      jsonb_build_object('order_id', p_order_id, 'requires_credentials', v_requires_credentials)
    );

    if not v_requires_credentials and v_order.preferred_booster_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.preferred_booster_id,
        'exclusive_job',
        'Pedido exclusivo para você!',
        'Um cliente pediu boost diretamente com você. Você tem 3 horas para aceitar antes que ele volte para a fila geral.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;
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
        v_order.total_price, 'Reembolso processado pelo Mercado Pago', v_order.customer_id, 'completed'
      )
      on conflict (mp_refund_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  to service_role;

create or replace function public.release_paid_order_after_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.credentials_set = true
     and old.credentials_set = false
     and new.payment_status = 'paid'::public.payment_status
     and new.status = 'awaiting_customer'::public.order_status
     and new.assigned_booster_id is null
     and public.order_requires_access_token(new.service_type, new.boost_mode) then
    update public.orders
    set status = 'awaiting_assignment',
        exclusive_until = case
          when new.preferred_booster_id is not null then now() + interval '3 hours'
          else null
        end,
        updated_at = now()
    where id = new.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      new.id, 'awaiting_customer', 'awaiting_assignment', new.customer_id,
      'Credenciais enviadas; pedido liberado para os boosters'
    );

    if new.preferred_booster_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        new.preferred_booster_id,
        'exclusive_job',
        'Pedido exclusivo para você!',
        'O cliente enviou as credenciais. Você tem 3 horas para aceitar antes que o pedido volte para a fila geral.',
        jsonb_build_object('order_id', new.id)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.release_paid_order_after_credentials() from public, anon, authenticated;

drop trigger if exists release_paid_order_after_credentials on public.orders;
create trigger release_paid_order_after_credentials
after update of credentials_set on public.orders
for each row execute function public.release_paid_order_after_credentials();

-- Repair paid orders created under the previous transition rule. They were
-- already hidden from boosters by the secure view, but the customer-facing
-- status incorrectly said they were awaiting assignment.
with moved as (
  update public.orders
  set status = 'awaiting_customer',
      exclusive_until = null,
      updated_at = now()
  where payment_status = 'paid'::public.payment_status
    and status = 'awaiting_assignment'::public.order_status
    and assigned_booster_id is null
    and credentials_set = false
    and public.order_requires_access_token(service_type, boost_mode)
  returning id, customer_id
)
insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
select
  id, 'awaiting_assignment', 'awaiting_customer', customer_id,
  'Fluxo corrigido: aguardando credenciais do cliente'
from moved;
