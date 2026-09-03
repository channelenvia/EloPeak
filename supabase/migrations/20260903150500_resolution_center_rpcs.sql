-- Centro de resolução: reconstrói admin_create_manual_refund (achado do
-- checkup -- essa função nunca existiu em nenhuma migration versionada,
-- foi criada direto no banco; comportamento reconstruído a partir dos
-- comentários/mensagens de erro em src/api/orders/mutations.ts e
-- src/features/admin/pages/OrderDetail.tsx/Refunds.tsx, que já a
-- referenciam há tempo) e adiciona admin_adjust_booster_balance, usando o
-- entry_type 'manual_admin_adjustment' que já existe no enum
-- ledger_entry_type desde a migration 081 mas nunca foi inserido por
-- nenhuma função. As duas ficam disponíveis na mesma tela ("A analisar",
-- ex-Reembolsos) pra negociar reembolso do cliente + saldo do booster
-- juntos -- sobretudo pedidos que caíram em 'under_review' pelo limite de
-- 2 drops (apply_order_drop, migration 20260903150200), mas seguem
-- utilizáveis pra qualquer pedido como já eram.

create or replace function public.admin_create_manual_refund(
  p_order_id uuid,
  p_reason   text,
  p_amount   numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_already_refunded numeric;
  v_remaining      numeric;
  v_refund_id      uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  select id, total_price, customer_id, payment_status
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds where order_id = p_order_id;

  v_remaining := v_order.total_price - v_already_refunded;

  if v_remaining <= 0 then
    return jsonb_build_object('success', false, 'error', 'already_refunded');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
  select p.id, p_order_id, 'manual-' || gen_random_uuid()::text, p_amount, v_reason, auth.uid(), 'succeeded', true
  from public.payments p where p.order_id = p_order_id order by p.created_at desc limit 1
  returning id into v_refund_id;

  if v_refund_id is null then
    return jsonb_build_object('success', false, 'error', 'payment_not_found');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount, 'refund_id', v_refund_id));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Reembolso processado',
      'R$ ' || p_amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id, 'amount', p_amount)
    );
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund_id, 'remaining', v_remaining - p_amount);
end;
$$;

revoke all on function public.admin_create_manual_refund(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_create_manual_refund(uuid, text, numeric) to authenticated;

-- Ajuste manual do saldo do booster -- p_amount pode ser positivo (crédito)
-- ou negativo (débito, ex.: recuperar uma penalidade que não coube inteira
-- no drop). Só grava no ledger (booster_available_balance já soma tudo) --
-- não mexe em total_earnings, que é "ganhos históricos" e nunca decresce
-- com penalidade/ajuste em nenhum outro lugar do sistema (ver apply_order_drop).
create or replace function public.admin_adjust_booster_balance(
  p_booster_id uuid,
  p_amount     numeric,
  p_reason     text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
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
$$;

revoke all on function public.admin_adjust_booster_balance(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_booster_balance(uuid, numeric, text) to authenticated;

-- Lista, pra tela "A analisar": pedidos under_review (limite de 2 drops
-- atingido) -- o admin resolve reembolso + saldo do booster negociando
-- pelo chat do próprio pedido (OrderDetailShell já embute o chat com
-- viewerRole="admin", ver src/features/admin/pages/OrderDetail.tsx).
create or replace function public.admin_list_review_cases()
returns table(
  order_id            uuid,
  order_status        public.order_status,
  total_price         numeric,
  customer_id         uuid,
  last_assigned_booster_id uuid,
  drop_count          integer,
  refunded_amount     numeric,
  updated_at          timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    o.id, o.status, o.total_price, o.customer_id,
    (select oba.booster_id from public.order_booster_assignments oba
      where oba.order_id = o.id and oba.unassigned_at is not null
      order by oba.unassigned_at desc limit 1),
    o.drop_count,
    coalesce((select sum(r.amount) from public.refunds r where r.order_id = o.id), 0),
    o.updated_at
  from public.orders o
  where public.is_admin()
    and o.status = 'under_review'
  order by o.updated_at desc;
$$;

revoke all on function public.admin_list_review_cases() from public, anon;
grant execute on function public.admin_list_review_cases() to authenticated;
