-- Achado da 4ª rodada do checkup (fora do sistema de drop): process_mp_payment_event
-- tem 2 bugs reais no caminho de reembolso/chargeback:
--
--   1) ALTO: a checagem de reconciliação (currency/amount) compara o valor
--      reportado pelo Mercado Pago contra orders.total_price -- mas
--      total_price é mutável (apply_order_drop reduz ele proporcionalmente
--      a cada drop, migrations 116/125/128-132). Pra QUALQUER pedido que
--      já foi dropado alguma vez (fluxo normal, suportado, rastreado por
--      drop_count), um reembolso ou chargeback real chega com o valor
--      ORIGINAL (que o Mercado Pago sempre reporta certo), não bate mais
--      com o total_price já reduzido, e a função inteira falha com
--      'payment_reconciliation_failed' -- o pedido nunca transiciona pra
--      'refunded'/'disputed' e a comissão do booster NUNCA é estornada.
--      Fix: comparar contra payments.amount (o valor gravado na hora do
--      pagamento, nunca mutado depois -- ver record_pix_payment,
--      migration 007) em vez de orders.total_price.
--
--   2) MÉDIO: quando o clawback roda, ele soma TODOS os commission_credit
--      do pedido (que pode ter mais de um booster, se foi dropado e
--      reatribuído no meio do caminho) mas debita o valor inteiro do
--      booster ATUALMENTE atribuído -- cobrando de um booster inocente
--      (que só recebeu sua própria comissão parcial) pelo que outro
--      booster recebeu antes dele. Fix: agrupa por booster_id e debita
--      cada um só pelo que ele de fato recebeu.

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
  v_booster_credit record;
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

  -- Idempotência explícita: o Mercado Pago reentrega o mesmo evento em
  -- loop enquanto não recebe 2xx, e cada branch abaixo hoje só é
  -- protegido indiretamente (por já checar o status atual antes de agir).
  -- Isso é frágil pra qualquer branch futuro que não siga esse padrão.
  if p_event_id is not null and v_payment.webhook_event_id = p_event_id then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;

  -- Compara contra o valor gravado no pagamento (payments.amount, imutável
  -- desde record_pix_payment), não orders.total_price -- esse último muda
  -- toda vez que o pedido é dropado, e o MP sempre reporta o valor
  -- ORIGINAL pago, então comparar contra total_price quebra a
  -- reconciliação de qualquer pedido que já foi dropado uma vez.
  if lower(p_currency) <> 'brl' or round(p_amount, 2) <> round(v_payment.amount, 2) then
    -- Notifica os admins só uma vez por pedido (o MP reentrega o mesmo
    -- evento em loop enquanto recebermos != 2xx, então sem esse guard cada
    -- retry viraria uma notificação nova).
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
          then now() + interval '12 hours'
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
        'Um cliente pediu boost diretamente com você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
        jsonb_build_object('order_id', p_order_id)
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
        v_order.total_price, 'Reembolso processado pelo Mercado Pago', v_order.customer_id, 'completed'
      )
      on conflict (mp_refund_id) do nothing;
    end if;

    if v_order.status = 'completed' then
      -- Agrupa por booster_id: um pedido dropado e reatribuído pode ter
      -- commission_credit de mais de um booster (pagamento parcial de
      -- quem dropou + comissão de quem terminou). Cada um só é debitado
      -- pelo que ele mesmo recebeu -- nunca soma tudo num único booster.
      for v_booster_credit in
        select booster_id, coalesce(sum(amount), 0) as credited
        from public.booster_ledger_entries
        where order_id = p_order_id and entry_type = 'commission_credit'
        group by booster_id
        having coalesce(sum(amount), 0) > 0
      loop
        perform 1 from public.booster_profiles where user_id = v_booster_credit.booster_id for update;

        insert into public.booster_ledger_entries(
          booster_id, order_id, entry_type, amount, description, metadata
        ) values (
          v_booster_credit.booster_id, p_order_id, 'refund_debit', -v_booster_credit.credited,
          case when p_provider_status = 'refunded'
            then 'Estorno da comissão -- pedido reembolsado pelo Mercado Pago após conclusão'
            else 'Estorno da comissão -- chargeback recebido pelo Mercado Pago após conclusão'
          end,
          jsonb_build_object('mp_payment_id', p_mp_payment_id, 'provider_status', p_provider_status)
        );

        insert into public.notifications(user_id, type, title, body, data)
        values (
          v_booster_credit.booster_id,
          'commission_clawed_back',
          'Comissão estornada',
          case when p_provider_status = 'refunded'
            then 'O cliente foi reembolsado pelo Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_booster_credit.credited::text || ' foi estornada do seu saldo.'
            else 'Houve um chargeback no Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_booster_credit.credited::text || ' foi estornada do seu saldo.'
          end,
          jsonb_build_object('order_id', p_order_id, 'amount', v_booster_credit.credited)
        );

        insert into public.notifications(user_id, type, title, body, data)
        select id, 'commission_clawed_back_admin',
          'Estorno de comissão após pedido concluído',
          'Pedido ' || p_order_id::text || ' foi ' || (case when p_provider_status = 'refunded' then 'reembolsado' else 'contestado (chargeback)' end)
            || ' depois de já concluído. R$ ' || v_booster_credit.credited::text || ' foram estornados do saldo do booster -- confirme diretamente com ele se já houve saque desse valor.',
          jsonb_build_object('order_id', p_order_id, 'booster_id', v_booster_credit.booster_id, 'amount', v_booster_credit.credited)
        from public.profiles where role = 'admin';
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  to service_role;
