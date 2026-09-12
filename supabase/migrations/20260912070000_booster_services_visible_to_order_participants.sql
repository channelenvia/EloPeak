-- Bug: booster_services_read (migration 070) only allows a row when the
-- caller owns it OR it's_active + the booster is approved. Once a booster
-- deactivates/soft-deletes a coaching package (toggleCoachingPackageActive /
-- deleteCoachingPackage), the customer and any admin viewing an order that
-- still references it via booster_service_id get zero rows back from RLS
-- (getBoosterServiceById/listBoosterServicesByIds run no is_active/deleted_at
-- filter client-side, but RLS enforces it anyway) — the order screen can no
-- longer render the coaching package's title/description. The assigned
-- booster was never affected (booster_id = auth.uid() already covers their
-- own package regardless of status). Fix: also allow reading a package when
-- it's referenced by an order the caller is customer/booster/admin on, same
-- pattern already used by order_coaching_topics_read (migration 109).
drop policy if exists "booster_services_read" on public.booster_services;
create policy "booster_services_read" on public.booster_services
for select
using (
  booster_id = auth.uid()
  or (is_active and public.is_approved_booster(booster_id))
  or public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.booster_service_id = booster_services.id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  )
);
