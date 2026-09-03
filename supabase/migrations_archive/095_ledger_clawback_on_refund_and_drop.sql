-- Achados HIGH da auditoria de pagamentos/ciclo de vida desta sessão:
--
-- 1) process_mp_payment_event (047) só bloqueia a transição pra
--    'refunded'/'disputed' quando o pedido JÁ está nesses status -- não
--    exclui 'completed'. Quando um chargeback/reembolso chega DEPOIS do
--    pedido ter sido marcado 'completed' (trg_fn_order_completed_booster_stats,
--    081, já creditou a comissão em booster_ledger_entries), o status do
--    pedido muda corretamente, mas a comissão já paga ao booster nunca é
--    estornada -- o tipo 'refund_debit' existe no enum ledger_entry_type
--    desde 081 e nunca foi usado em lugar nenhum. Resultado: o cliente recebe
--    o dinheiro de volta via Mercado Pago e o booster fica com a comissão
--    inteira (podendo já ter sacado via request_payout).
--
-- 2) resolve_drop_request (001, só re-editado em 033 pra validação de
--    reason) aplica a penalidade de drop SÓ via
--    `booster_profiles.total_earnings -= penalty_amount` -- o mecanismo
--    PRÉ-081. Desde que booster_ledger_entries virou a fonte de verdade do
--    saldo sacável (available_balance = soma dos lançamentos, sem olhar
--    total_earnings), essa penalidade nunca afeta o saldo disponível de
--    verdade -- o tipo 'drop_penalty' do enum também nunca foi usado.
--
-- Ambos os casos: em vez de só descontar em silêncio (o que pode deixar o
-- saldo negativo sem o booster entender o motivo), o lançamento de estorno
-- vem acompanhado de notificação pro booster E pra todos os admins (mesmo
-- padrão de broadcast de request_order_support, migration 083) -- a
-- reconciliação de fato (se o booster já sacou, como cobrar de volta etc.)
-- é tratada diretamente entre admin e booster fora do sistema, mas agora com
-- registro visível e saldo correto pra basear essa conversa.

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
  v_credited_amount numeric(10,2);
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

    -- Clawback: o pedido já tinha sido 'completed' (comissão já creditada ao
    -- booster) quando o reembolso/chargeback chegou. Estorna exatamente o
    -- que foi creditado -- nunca um valor recalculado, pra nunca divergir do
    -- que realmente entrou no saldo do booster.
    if v_order.status = 'completed' and v_order.assigned_booster_id is not null then
      select coalesce(sum(amount), 0) into v_credited_amount
        from public.booster_ledger_entries
        where order_id = p_order_id and entry_type = 'commission_credit';

      if v_credited_amount > 0 then
        insert into public.booster_ledger_entries(
          booster_id, order_id, entry_type, amount, description, metadata
        ) values (
          v_order.assigned_booster_id, p_order_id, 'refund_debit', -v_credited_amount,
          case when p_provider_status = 'refunded'
            then 'Estorno da comissão -- pedido reembolsado pelo Mercado Pago após conclusão'
            else 'Estorno da comissão -- chargeback recebido pelo Mercado Pago após conclusão'
          end,
          jsonb_build_object('mp_payment_id', p_mp_payment_id, 'provider_status', p_provider_status)
        );

        insert into public.notifications(user_id, type, title, body, data)
        values (
          v_order.assigned_booster_id,
          'commission_clawed_back',
          'Comissão estornada',
          case when p_provider_status = 'refunded'
            then 'O cliente foi reembolsado pelo Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_credited_amount::text || ' foi estornada do seu saldo.'
            else 'Houve um chargeback no Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_credited_amount::text || ' foi estornada do seu saldo.'
          end,
          jsonb_build_object('order_id', p_order_id, 'amount', v_credited_amount)
        );

        insert into public.notifications(user_id, type, title, body, data)
        select id, 'commission_clawed_back_admin',
          'Estorno de comissão após pedido concluído',
          'Pedido ' || p_order_id::text || ' foi ' || (case when p_provider_status = 'refunded' then 'reembolsado' else 'contestado (chargeback)' end)
            || ' depois de já concluído. R$ ' || v_credited_amount::text || ' foram estornados do saldo do booster -- confirme diretamente com ele se já houve saque desse valor.',
          jsonb_build_object('order_id', p_order_id, 'booster_id', v_order.assigned_booster_id, 'amount', v_credited_amount)
        from public.profiles where role = 'admin';
        -- Sem insert em audit_logs aqui de propósito: actor_id/actor_role são
        -- NOT NULL nessa tabela (sempre um profile real) e este é um evento
        -- automático disparado pelo webhook, sem ator humano -- mesmo padrão
        -- já usado no branch 'approved' acima, que também não grava em
        -- audit_logs. O próprio lançamento em booster_ledger_entries (imutável)
        -- mais order_status_history já são o registro de auditoria disso.
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text)
  to service_role;

-- ── Drop penalty: passa a debitar o ledger de verdade, não só total_earnings ──

create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve    boolean,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req   record;
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.penalty_amount, r.status
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    update public.orders set status = 'canceled', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'canceled', auth.uid(), 'Drop request approved');
    if v_req.penalty_amount > 0 then
      update public.booster_profiles
      set    total_earnings = greatest(0, total_earnings - v_req.penalty_amount)
      where  user_id = v_req.booster_id;

      insert into public.booster_ledger_entries(
        booster_id, order_id, entry_type, amount, description, actor_id, actor_role
      ) values (
        v_req.booster_id, v_req.order_id, 'drop_penalty', -v_req.penalty_amount,
        'Penalidade por abandono do pedido ' || v_req.order_id::text,
        auth.uid(), 'admin'::public.user_role
      );

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_req.booster_id,
        'drop_penalty_applied',
        'Penalidade de abandono aplicada',
        'Seu pedido de drop foi aprovado. Uma penalidade de R$ ' || v_req.penalty_amount::text || ' foi descontada do seu saldo.',
        jsonb_build_object('order_id', v_req.order_id, 'amount', v_req.penalty_amount)
      );
    end if;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'penalty_amount', v_req.penalty_amount));
  else
    update public.orders set status = 'in_progress', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'in_progress', auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));
  end if;

  update public.order_drop_requests
  set    status      = case when p_approve then 'approved' else 'rejected' end,
         admin_id    = auth.uid(),
         admin_note  = p_admin_note,
         resolved_at = now()
  where  id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.resolve_drop_request(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_drop_request(uuid, boolean, text) to authenticated;
