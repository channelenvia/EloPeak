-- Bug (LOW, perf): as policies boosters_select_own_drop_requests e
-- admins_update_drop_requests em order_drop_requests chamam auth.uid()/
-- is_admin() sem envolver em (select ...), impedindo o initplan do Postgres
-- de cachear o resultado por statement (reavalia a função por linha em vez
-- de uma vez por query).
--
-- Fix: envolver as chamadas como (select auth.uid()) / (select is_admin()).
drop policy if exists "boosters_select_own_drop_requests" on public.order_drop_requests;
create policy "boosters_select_own_drop_requests" on public.order_drop_requests
  for select
  using (booster_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "admins_update_drop_requests" on public.order_drop_requests;
create policy "admins_update_drop_requests" on public.order_drop_requests
  for update
  using ((select public.is_admin()));
