-- Pedidos configurados agora são persistidos antes da criação da cobrança.
-- Portanto, `orders.created_at` não representa mais o início dos 30 minutos
-- do PIX. Expira somente pedidos que realmente possuem uma cobrança pendente
-- há mais de 35 minutos, usando payments.created_at como relógio.
create or replace function public.expire_stale_pix_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
        and p.created_at < now() - interval '35 minutes'
    );
end;
$$;

revoke all on function public.expire_stale_pix_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_pix_orders() to service_role;
