-- Coaching é sempre exclusivo do booster dono do pacote -- diferente de um
-- pedido "vinculado" normal (perfil público), que cai pro pool geral depois
-- de 12h se o booster preferido não aceitar. Até agora process_mp_payment_event
-- tratava os dois casos igual (exclusive_until = now() + 12h), então um
-- pedido de coaching não aceito em 12h vazava pro pool geral e QUALQUER
-- booster aprovado podia aceitá-lo -- errado, já que o pacote pertence a um
-- booster específico. Duas mudanças:
--   1. available_boost_orders passa a exigir preferred_booster_id = auth.uid()
--      pra coaching incondicionalmente, sem depender de exclusive_until.
--   2. process_mp_payment_event não seta mais exclusive_until pra coaching
--      (fica null -- não tem mais sentido, a exclusividade permanente é
--      garantida pela view acima) e a notificação não menciona mais um prazo
--      de 12h que não existe nesse caso.

create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type,
  clash_tier, clash_day
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    case
      when service_type = 'coaching' then preferred_booster_id = auth.uid()
      else preferred_booster_id is null
        or exclusive_until is null
        or exclusive_until <= now()
        or preferred_booster_id = auth.uid()
    end
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  )
  and not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = auth.uid() and bp.blocked_until is not null and bp.blocked_until > now()
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;

create or replace function public.process_mp_payment_event(
  p_order_id uuid,
  p_mp_payment_id text,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_event_id text,
  p_refund_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
      -- Coaching não usa mais janela de tempo -- a exclusividade é permanente,
      -- garantida por available_boost_orders (service_type = 'coaching' exige
      -- preferred_booster_id = auth.uid() incondicionalmente), então
      -- exclusive_until não tem mais função nesse caso.
      exclusive_until = case
        when v_order.service_type = 'coaching' then null
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
        case when v_order.service_type = 'coaching'
          then 'Um cliente comprou seu pacote de coaching. Esse pedido é exclusivo seu -- só você pode aceitá-lo.'
          else 'Um cliente pediu boost diretamente com você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.'
        end,
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
