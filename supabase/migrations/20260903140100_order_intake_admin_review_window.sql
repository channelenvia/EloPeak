-- Janela de revisão de 1 minuto do admin antes de um pedido recém-contratado
-- (pagamento confirmado, ou credenciais enviadas quando o serviço exige)
-- cair na aba de pedidos dos boosters / ser anunciado no Discord. Durante
-- esse minuto o pedido fica em 'pending_review' -- nem process_mp_payment_
-- event nem release_paid_order_after_credentials mais jogam direto pra
-- 'awaiting_assignment'; quem faz essa transição final agora é
-- _release_pending_review_order (chamada pelo cron abaixo, ou manualmente
-- pelas RPCs de admin). Isso cobre os dois caminhos que hoje levam um
-- pedido "recém-contratado" a virar visível -- reaberturas por drop/
-- reatribuição continuam indo direto pra awaiting_assignment como sempre
-- (a janela é só pra pedido novo, não pra pedido devolvido ao pool).
--
-- O anúncio no Discord (discord-order-channel) e a visibilidade no pool
-- (available_boost_orders) já são inteiramente condicionados a
-- status = 'awaiting_assignment' -- não precisam de nenhuma mudança: atrasar
-- essa transição já atrasa os dois efeitos automaticamente.

alter table public.orders
  add column review_release_at   timestamptz,
  add column admin_review_locked boolean not null default false;

comment on column public.orders.review_release_at is
  'Quando um pedido pending_review deve ser liberado automaticamente pro pool (now() + 1 minuto, calculado na entrada do status). Null fora de pending_review.';
comment on column public.orders.admin_review_locked is
  'true trava a liberação automática de um pedido pending_review -- só sai de pending_review quando o admin destravar/atribuir/cancelar manualmente.';

-- ─── process_mp_payment_event: pagamento aprovado sem exigência de credenciais
-- vai pra pending_review em vez de awaiting_assignment direto. exclusive_until
-- e a notificação de "pedido exclusivo" pro preferred_booster_id são adiadas
-- pra _release_pending_review_order -- o booster não pode saber do pedido
-- antes da janela de revisão terminar, senão o admin cancelar/reatribuir
-- durante a janela vira uma notificação fantasma. Resto da função (reject/
-- refund/chargeback) idêntico à versão vigente (migration 133).
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
    status = v_payment_status,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_order.status = 'awaiting_payment' then
    v_requires_credentials := public.order_requires_access_token(v_order.service_type, v_order.boost_mode);
    v_to_status := case
      when v_requires_credentials then 'awaiting_customer'::public.order_status
      else 'pending_review'::public.order_status
    end;

    update public.orders set
      status = v_to_status,
      payment_status = 'paid',
      review_release_at = case when not v_requires_credentials then now() + interval '1 minute' else null end,
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

-- ─── release_paid_order_after_credentials: mesma lógica, mas o destino
-- passa a ser pending_review -- exclusive_until e a notificação exclusiva
-- também adiadas pra _release_pending_review_order.
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
    set status = 'pending_review',
        review_release_at = now() + interval '1 minute',
        updated_at = now()
    where id = new.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      new.id, 'awaiting_customer', 'pending_review',  new.customer_id,
      'Credenciais enviadas; em revisão administrativa antes de ir pro pool'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.release_paid_order_after_credentials() from public, anon, authenticated;

-- ─── Liberação (automática via cron ou manual via RPC de admin) ───────────

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
  select id, customer_id, preferred_booster_id
  into v_order
  from public.orders
  where id = p_order_id and status = 'pending_review'
  for update;

  if not found then
    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null then now() + interval '12 hours'
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
  values (p_order_id, 'pending_review', 'awaiting_assignment', p_actor_id, p_reason);

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

-- Job periódico (mesmo padrão de expire_stale_pix_orders, migration 048):
-- roda a cada minuto, libera tudo que passou de review_release_at e não
-- está travado. skip locked evita esperar por uma linha que uma RPC de
-- admin esteja processando ao mesmo tempo.
create or replace function public.release_pending_review_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id from public.orders
    where status = 'pending_review'
      and admin_review_locked = false
      and review_release_at <= now()
    for update skip locked
  loop
    perform public._release_pending_review_order(
      v_order_id, null, 'Liberado automaticamente após a janela de revisão de 1 minuto'
    );
  end loop;
end;
$$;

revoke all on function public.release_pending_review_orders() from public, anon, authenticated;
grant execute on function public.release_pending_review_orders() to service_role;

do $$
begin
  perform cron.unschedule('release-pending-review-orders');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'release-pending-review-orders',
    '* * * * *',
    $cron$select public.release_pending_review_orders();$cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — release_pending_review_orders() exists but is not scheduled';
end $$;

-- ─── RPCs de admin durante a janela de revisão ─────────────────────────────

-- Travar (segura indefinidamente até destravar) ou destravar/liberar agora
-- (chama _release_pending_review_order imediatamente -- tanto pra destravar
-- um pedido travado quanto pra liberar antecipadamente um que ainda nem
-- tinha atingido o minuto).
create or replace function public.admin_set_pending_review_lock(
  p_order_id uuid,
  p_locked   boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'pending_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  if p_locked then
    update public.orders set admin_review_locked = true, updated_at = now() where id = p_order_id;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_locked', 'order', p_order_id::text, '{}'::jsonb);
  else
    perform public._release_pending_review_order(p_order_id, auth.uid(), 'Liberado manualmente pelo admin');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_unlocked', 'order', p_order_id::text, '{}'::jsonb);
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_set_pending_review_lock(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_pending_review_lock(uuid, boolean) to authenticated;

create or replace function public.admin_cancel_pending_review_order(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'pending_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  update public.orders
  set status               = 'canceled',
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at            = now()
  where id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'pending_review', 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_canceled', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido foi cancelado pela administração antes de ser liberado para os boosters. Motivo: ' || v_reason
        || '. O reembolso será tratado manualmente pela nossa equipe.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_cancel_pending_review_order(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_pending_review_order(uuid, text) to authenticated;

-- Atribui a um booster escolhido pelo admin: reserva exclusiva (preferred_
-- booster_id + exclusive_until de 12h, mesmo mecanismo de um pedido
-- comprado direto do perfil de um booster) -- não é atribuição imediata,
-- o booster ainda precisa aceitar. Só ele é notificado (discord-order-
-- channel já trata preferred_booster_id como DM-only, sem anúncio público).
create or replace function public.admin_assign_pending_review_order(
  p_order_id           uuid,
  p_target_booster_id  uuid,
  p_reason             text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_target record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'pending_review' then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set status                = 'awaiting_assignment',
      preferred_booster_id  = p_target_booster_id,
      exclusive_until       = now() + interval '12 hours',
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at             = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, 'pending_review', 'awaiting_assignment', auth.uid(),
    'Atribuído pelo admin durante a revisão: ' || v_reason
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'exclusive_job', 'Pedido reservado para você!',
    'Um administrador reservou este pedido pra você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_assigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'target_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_assign_pending_review_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_assign_pending_review_order(uuid, uuid, text) to authenticated;
