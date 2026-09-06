-- Reformulação do fluxo de revisão do admin, dois problemas reais + 1 mudança
-- pedida:
--
-- 1) AdminOrderDetailPage nunca tratava o status 'pending_review' -- o menu
--    de ações (AdminStatusActionsMenu) só considera ASSIGN_BOOSTER_STATUSES
--    (que não inclui pending_review) pra mostrar "Reatribuir", e não tinha
--    nenhuma opção de travar/disponibilizar ali (essas ações só existiam no
--    painel do dashboard, PendingReviewPanel.tsx). Resultado: um admin que
--    entrava direto na página do pedido não via como travar, e só conseguia
--    "reatribuir" depois que o pedido já tinha caído pro pool geral.
-- 2) Não existia nenhuma forma de colocar manualmente um pedido JÁ ATIVO
--    (com booster atribuído) em análise -- 'under_review' só era alcançado
--    automaticamente ao atingir o limite de 2 drops (apply_order_drop).
-- 3) Janela de revisão passa de 1 para 2 minutos.
--
-- Fix: um novo status "Analisar" (admin_flag_order_under_review) que joga
-- QUALQUER pedido pending_review OU ativo (assigned/in_progress/paused/
-- awaiting_customer) pra 'under_review' -- espelhando exatamente o que
-- apply_order_drop já faz no limite de 2 drops (desatribui booster, libera
-- reserva de duo, marca unassigned_at), só que sem mexer em drop_count (não
-- é um drop, é uma decisão manual do admin) e sem a matemática de payout
-- proporcional (o admin resolve manualmente depois, via "Ajustar saldo do
-- booster" em /admin/refunds -- painel que já lista qualquer status =
-- 'under_review', não só os que vieram de drop). As RPCs de
-- travar/atribuir/cancelar da janela de revisão (que já existiam, só não
-- apareciam na página do pedido) passam a aceitar 'under_review' como
-- status de origem também, cobrindo os dois estágios do novo menu:
--   pending_review -> Disponibilizar / Analisar / Atribuir / Cancelar
--   under_review    -> Disponibilizar / Reembolsar* / Atribuir / Cancelar
--   ativo (c/booster)-> Analisar / Reatribuir / Cancelar
-- (*Reembolsar reusa o link "Marcar pra reembolsar" que já existe, sem
-- mudança nenhuma -- só o destino final depois de Atribuir/Cancelar/
-- Disponibilizar que precisa saber lidar com a origem under_review agora.)

-- ─── 1. Janela de revisão: 1 -> 2 minutos ──────────────────────────────────

comment on column public.orders.review_release_at is
  'Quando um pedido pending_review deve ser liberado automaticamente pro pool (now() + 2 minutos, calculado na entrada do status). Null fora de pending_review.';

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
        review_release_at = now() + interval '2 minutes',
        updated_at = now()
    where id = new.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      new.id, 'awaiting_customer', 'pending_review',  new.customer_id,
      'Credenciais enviadas; em revisão administrativa antes de ir pro pool'
    );

    insert into public.notifications(user_id, type, title, body, data)
    select id, 'order_pending_review', 'Novo pedido pago -- em revisão',
      'Pedido ' || new.id::text || ' recebeu as credenciais e está na janela de revisão. Disponibilize, analise, atribua ou cancele.',
      jsonb_build_object('order_id', new.id)
    from public.profiles where role = 'admin';

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-review-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('order_id', new.id),
      timeout_milliseconds := 10000
    );
  end if;

  return new;
end;
$$;

revoke all on function public.release_paid_order_after_credentials() from public, anon, authenticated;

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
      v_order_id, null, 'Liberado automaticamente após a janela de revisão de 2 minutos'
    );
  end loop;
end;
$$;

revoke all on function public.release_pending_review_orders() from public, anon, authenticated;
grant execute on function public.release_pending_review_orders() to service_role;

-- ─── 2. RPCs de pending_review passam a aceitar under_review também ───────

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
  select id, status, customer_id, preferred_booster_id, service_type
  into v_order
  from public.orders
  where id = p_order_id and status in ('pending_review', 'under_review')
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
  values (p_order_id, v_order.status, 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

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
  if v_order.status not in ('pending_review', 'under_review') then
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
  if v_order.status not in ('pending_review', 'under_review') then
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
  values (p_order_id, v_order.status, 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_canceled', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido foi cancelado pela administração. Motivo: ' || v_reason
        || '. O reembolso será tratado manualmente pela nossa equipe.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_cancel_pending_review_order(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_pending_review_order(uuid, text) to authenticated;

create or replace function public.admin_assign_pending_review_order(p_order_id uuid, p_target_booster_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  select id, status, customer_id, service_type into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
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
      exclusive_until       = case when v_order.service_type = 'coaching' then null else now() + interval '12 hours' end,
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at            = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, v_order.status, 'awaiting_assignment', auth.uid(),
    'Atribuído pelo admin: ' || v_reason
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

-- ─── 3. "Analisar": novo status manual pra pending_review OU pedido ativo ──
--
-- Quando havia um booster ativo, reusa apply_order_drop (mesmo pattern de
-- admin_reassign_booster/admin_drop_order) em vez de reimplementar a
-- desatribuição na unha: isso garante o pagamento proporcional ao progresso
-- entregue (formula certa por service_type -- win_boost/md5, elo_boost
-- Mestre+, elo_boost padrão, genérico), a reprecificação do restante, e o
-- reset de wins_played/losses_played/match_sync_started_at (sem isso, o
-- cronômetro "tempo estimado" continuaria contando a partir do início
-- original quando um novo booster assumisse depois, incluindo o tempo
-- parado em análise). apply_order_drop sempre reabre pra 'awaiting_
-- assignment' (ou 'under_review' direto, se já tiver batido o limite de 2
-- drops -- nesse caso sem payout, mesma regra de sempre) -- como "Analisar"
-- quer travar em vez de devolver pro pool na hora, sobrescrevemos pra
-- under_review logo em seguida quando não for o caso do limite.
--
-- Quando vem de pending_review sem booster nenhum, não há o que pagar -- só
-- troca o status (preferred_booster_id/exclusive_until ficam intactos,
-- "Disponibilizar" depois restaura a exclusividade certa).
create or replace function public.admin_flag_order_under_review(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_from_status public.order_status;
  v_drop_result jsonb;
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
  if v_order.status not in ('pending_review', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_from_status := v_order.status;

  if v_order.assigned_booster_id is not null then
    v_drop_result := public.apply_order_drop(p_order_id, v_from_status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role);

    if not (v_drop_result->>'success')::boolean then
      return v_drop_result;
    end if;

    -- Limite de 2 drops: apply_order_drop já cancelou e deixou em
    -- under_review sozinho (sem payout -- mesma regra de sempre pra esse
    -- caso, ver ReviewCaseCard/admin_adjust_booster_balance). Nada mais a
    -- fazer, o histórico e as notificações já saíram de lá.
    if coalesce((v_drop_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', true, 'drop_result', v_drop_result);
    end if;

    -- Caminho normal: apply_order_drop já pagou o booster e reabriu pro
    -- pool (awaiting_assignment) -- sobrescreve pra under_review, que é o
    -- que "Analisar" pede (trava até o admin decidir) em vez de deixar
    -- disponível pra qualquer booster aceitar na hora.
    update public.orders
    set status = 'under_review', updated_at = now()
    where id = p_order_id and status = 'awaiting_assignment';

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'awaiting_assignment', 'under_review', auth.uid(), 'Colocado em análise manual pelo admin: ' || v_reason);

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido entrou em análise manual da nossa equipe -- ainda não voltou pra fila de boosters. Entraremos em contato se precisarmos de mais informações.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'from_status', v_from_status, 'drop_result', v_drop_result));

    return jsonb_build_object('success', true, 'drop_result', v_drop_result);
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
$$;

revoke all on function public.admin_flag_order_under_review(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_flag_order_under_review(uuid, text) to authenticated;
