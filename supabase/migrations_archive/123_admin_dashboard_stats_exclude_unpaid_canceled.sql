-- Pedidos 'awaiting_payment' e 'canceled' inflavam o gráfico "pedidos por
-- dia" e a lista "pedidos recentes" do painel do admin -- métricas que devem
-- refletir pedidos reais, não tentativas que nunca foram pagas ou que foram
-- canceladas. Esses pedidos continuam visíveis normalmente na aba Pedidos
-- (listAdminOrders): 'awaiting_payment' aparece em "Todos", 'canceled' via
-- filtro explícito de status.
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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

  select coalesce(sum(amount), 0) into v_total_revenue
  from public.payments where status = 'paid';

  select coalesce(sum(net_amount), 0) into v_total_payouts
  from public.payout_records;

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
    from generate_series(current_date - interval '6 days', current_date, interval '1 day') gs
    left join public.orders o
      on o.created_at::date = gs::date
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
$$;
