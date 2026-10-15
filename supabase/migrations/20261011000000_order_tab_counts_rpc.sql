-- Contagem de pedidos por aba em UMA consulta (antes: 5 requests HEAD count por refresh,
-- por papel, a cada 30s e a cada evento realtime). SECURITY INVOKER: a RLS de orders
-- continua decidindo o que cada papel enxerga; o filtro de dono é só o recorte da aba.
create or replace function public.order_tab_counts(
  p_owner text default null,       -- 'customer' | 'booster' | null (admin: sem filtro de dono)
  p_owner_id uuid default null,
  p_admin boolean default false    -- admin inclui pending_review em "in_progress"
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'in_progress', count(*) filter (where o.status = any (
      case when p_admin
        then array['pending_review','paid','awaiting_assignment','assigned','in_progress','paused','drop_requested','awaiting_customer']
        else array['paid','awaiting_assignment','assigned','in_progress','paused','drop_requested','awaiting_customer']
      end::public.order_status[])),
    'em_analise', count(*) filter (where o.status = any (
      array['awaiting_payment','under_review','disputed','refunded']::public.order_status[])),
    'completed', count(*) filter (where o.status = 'completed'),
    'all',       count(*) filter (where o.status <> 'draft'),
    'canceled',  count(*) filter (where o.status = 'canceled')
  )
  from public.orders o
  where o.status <> 'draft'
    and (
      p_owner is null
      or (p_owner = 'customer' and o.customer_id = p_owner_id)
      or (p_owner = 'booster' and o.assigned_booster_id = p_owner_id)
    );
$$;

revoke all on function public.order_tab_counts(text, uuid, boolean) from public, anon;
grant execute on function public.order_tab_counts(text, uuid, boolean) to authenticated;
