-- Remove duplicate permissive INSERT policies on booster_applications.
--
-- Users keep the dedicated insert policy for their own pending application.
-- Admins keep read/update/delete management without an overlapping INSERT
-- policy, which the admin UI does not need.

drop policy if exists "Admins can manage applications" on public.booster_applications;

create policy "booster_applications_admin_select"
on public.booster_applications
for select
using (public.is_admin());

create policy "booster_applications_admin_update"
on public.booster_applications
for update
using (public.is_admin())
with check (public.is_admin());

create policy "booster_applications_admin_delete"
on public.booster_applications
for delete
using (public.is_admin());
