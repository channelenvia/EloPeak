-- The browser removes an expired PIX immediately at the provider timestamp.
-- This database fallback handles users who closed the site. Keep a five
-- minute reconciliation grace for delayed Mercado Pago webhooks, then cancel
-- the unpaid order. Customer queries hide canceled rows; admins retain the
-- record for payment/audit investigation.
create or replace function public.expire_stale_pix_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with expired as (
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
      )
    returning o.id, o.customer_id
  )
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  select
    id, 'awaiting_payment', 'canceled', customer_id,
    'PIX expirado sem confirmação de pagamento'
  from expired;
end;
$$;

revoke all on function public.expire_stale_pix_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_pix_orders() to service_role;

-- The original job ran every ten minutes, which could leave an expired order
-- visible for too long after the reconciliation grace.
do $$
begin
  perform cron.unschedule('expire-stale-pix-orders');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'expire-stale-pix-orders',
    '* * * * *',
    $cron$select public.expire_stale_pix_orders();$cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — expire_stale_pix_orders() exists but is not scheduled';
end $$;
