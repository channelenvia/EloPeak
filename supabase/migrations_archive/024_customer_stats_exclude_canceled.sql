-- trg_fn_order_paid_customer_stats (migration 001) only ever incremented
-- customer_profiles.total_orders/total_spent when an order first became
-- payable (awaiting_payment -> awaiting_assignment) -- it never reversed
-- that increment if the order was later canceled or refunded. Result: a
-- customer's persisted "total spent" kept counting money for orders that
-- no longer represent money actually spent, and the customer dashboard
-- (which reads this same figure) showed an inflated total forever.
--
-- This migration:
--   1. Extends the trigger to decrement total_orders/total_spent exactly
--      once, when a previously-counted order (anything past
--      draft/awaiting_payment) transitions into canceled or refunded --
--      the exact inverse of the existing increment condition, so an order
--      is never double-counted or double-reversed.
--   2. Backfills every existing customer_profiles row so already-corrupted
--      totals (from cancellations that happened before this fix existed)
--      are corrected retroactively, not just going forward.
--
-- Non-destructive: only recomputes two numeric columns from the orders
-- that already exist, no row is dropped, no schema change.

create or replace function public.trg_fn_order_paid_customer_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'awaiting_assignment' and OLD.status = 'awaiting_payment' then
    update public.customer_profiles
      set total_orders = total_orders + 1,
          total_spent  = total_spent + NEW.total_price
      where user_id = NEW.customer_id;
  end if;

  -- Reverses the increment above when a previously-counted order (i.e. one
  -- that had already moved past draft/awaiting_payment, so it was actually
  -- added to the totals at some point) ends up canceled or refunded.
  -- OLD.status not in (..., 'canceled', 'refunded') also guards against
  -- ever reversing the same order's contribution twice.
  if NEW.status in ('canceled', 'refunded')
     and OLD.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded') then
    update public.customer_profiles
      set total_orders = greatest(0, total_orders - 1),
          total_spent  = greatest(0, total_spent - NEW.total_price)
      where user_id = NEW.customer_id;
  end if;

  return NEW;
end;
$$;

-- Backfill: recompute every customer's totals from scratch, counting only
-- orders whose current status represents money genuinely spent (i.e. the
-- same statuses the trigger above would keep counted).
update public.customer_profiles cp
set total_orders = coalesce(sub.cnt, 0),
    total_spent  = coalesce(sub.sum_price, 0)
from (
  select customer_id, count(*) as cnt, sum(total_price) as sum_price
  from public.orders
  where status not in ('draft', 'awaiting_payment', 'canceled', 'refunded')
  group by customer_id
) sub
where cp.user_id = sub.customer_id;

-- Customers with zero qualifying orders (e.g. every order they ever placed
-- ended up canceled) don't appear in the aggregated subquery above at all
-- -- reset those explicitly instead of leaving a stale total.
update public.customer_profiles cp
set total_orders = 0, total_spent = 0
where not exists (
  select 1 from public.orders o
  where o.customer_id = cp.user_id
    and o.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded')
);
