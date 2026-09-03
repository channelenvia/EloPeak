-- Schema hardening pass after advisor review.
--
-- Scope:
-- - remove default anonymous EXECUTE from public functions;
-- - pin function search_path to reduce SECURITY DEFINER risk;
-- - split broad FOR ALL write policies so SELECT has a single permissive path;
-- - make the admin-only duo-account view run as invoker.
--
-- Public/booster-facing masking views are intentionally not switched to
-- security_invoker here because they currently hide sensitive base-table
-- columns. Moving those to invoker safely requires a dedicated RPC or
-- column-grant refactor.

-- SECURITY DEFINER and helper functions should not inherit a caller-controlled
-- search_path. This is safe for existing functions because schema-qualified
-- references such as auth.uid(), public.is_admin() and vault.* remain explicit.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_depend d
        where d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format('alter function %s set search_path = public, extensions', fn.signature);
  end loop;
end $$;

-- Remove the default EXECUTE grant that makes public RPCs callable by anon
-- through PostgREST. Explicit grants below preserve intended authenticated and
-- service_role flows.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

grant execute on all functions in schema public to service_role;

grant execute on function public.accept_boost_order(uuid, uuid) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_override_order_status(uuid, text, text) to authenticated;
grant execute on function public.approve_booster(uuid, text) to authenticated;
grant execute on function public.assign_ticket(uuid) to authenticated;
grant execute on function public.booster_active_slot_counts(uuid) to authenticated;
grant execute on function public.booster_has_active_exclusive_slot(uuid) to authenticated;
grant execute on function public.booster_payout_summary(uuid) to authenticated;
grant execute on function public.can_booster_accept_order(uuid, text) to authenticated;
grant execute on function public.check_own_write_rate_limit(text, integer, integer) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.ensure_profile_exists(text) to authenticated;
grant execute on function public.get_duo_account_credentials(uuid) to authenticated;
grant execute on function public.get_order_credentials(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved_booster() to authenticated;
grant execute on function public.log_match_result(uuid, integer, integer) to authenticated;
grant execute on function public.moderate_review(uuid, boolean) to authenticated;
grant execute on function public.onboard_booster(text, text, jsonb, text, integer, integer) to authenticated;
grant execute on function public.onboard_booster(text, text, jsonb, text, integer, integer, text, text) to authenticated;
grant execute on function public.order_requires_access_token(public.service_type, text) to authenticated;
grant execute on function public.rank_step(text, text) to authenticated;
grant execute on function public.request_booster_role() to authenticated;
grant execute on function public.request_order_drop(uuid, text) to authenticated;
grant execute on function public.resolve_drop_request(uuid, boolean, text) to authenticated;
grant execute on function public.set_duo_account_credentials(uuid, text, text) to authenticated;
grant execute on function public.set_order_credentials(uuid, text, text) to authenticated;
grant execute on function public.set_order_credentials(uuid, text, text, text) to authenticated;
grant execute on function public.toggle_booster_top5(uuid, boolean) to authenticated;
grant execute on function public.update_my_username(text) to authenticated;
grant execute on function public.update_order_status(uuid, text, text) to authenticated;

grant execute on function public.complete_verified_order(uuid, text, text, uuid) to service_role;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.process_mp_payment_event(uuid, text, text, numeric, text, text, text) to service_role;
grant execute on function public.record_pix_payment(uuid, uuid, text, numeric) to service_role;
grant execute on function public.resolve_order_access_token(text) to service_role;

-- Avoid duplicate permissive SELECT policies caused by FOR ALL admin/write
-- policies. Public read behavior remains unchanged.
drop policy if exists "games_admin_write" on public.games;
create policy "games_admin_insert" on public.games for insert with check (public.is_admin());
create policy "games_admin_update" on public.games for update using (public.is_admin()) with check (public.is_admin());
create policy "games_admin_delete" on public.games for delete using (public.is_admin());

drop policy if exists "services_admin_write" on public.services;
create policy "services_admin_insert" on public.services for insert with check (public.is_admin());
create policy "services_admin_update" on public.services for update using (public.is_admin()) with check (public.is_admin());
create policy "services_admin_delete" on public.services for delete using (public.is_admin());

drop policy if exists "service_extras_admin_write" on public.service_extras;
create policy "service_extras_admin_insert" on public.service_extras for insert with check (public.is_admin());
create policy "service_extras_admin_update" on public.service_extras for update using (public.is_admin()) with check (public.is_admin());
create policy "service_extras_admin_delete" on public.service_extras for delete using (public.is_admin());

drop policy if exists "master_plus_pricing_admin_write" on public.master_plus_pricing;
create policy "master_plus_pricing_admin_insert" on public.master_plus_pricing for insert with check (public.is_admin());
create policy "master_plus_pricing_admin_update" on public.master_plus_pricing for update using (public.is_admin()) with check (public.is_admin());
create policy "master_plus_pricing_admin_delete" on public.master_plus_pricing for delete using (public.is_admin());

drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_insert" on public.payments for insert with check (public.is_admin());
create policy "payments_admin_update" on public.payments for update using (public.is_admin()) with check (public.is_admin());
create policy "payments_admin_delete" on public.payments for delete using (public.is_admin());

drop policy if exists "duo_accounts_admin_write" on public.duo_accounts;
create policy "duo_accounts_admin_insert" on public.duo_accounts for insert with check (public.is_admin());
create policy "duo_accounts_admin_update" on public.duo_accounts for update using (public.is_admin()) with check (public.is_admin());
create policy "duo_accounts_admin_delete" on public.duo_accounts for delete using (public.is_admin());

drop policy if exists "booster_services_owner_all" on public.booster_services;
drop policy if exists "booster_services_public_read" on public.booster_services;
create policy "booster_services_read" on public.booster_services
for select
using (
  booster_id = auth.uid()
  or exists (
    select 1
    from public.booster_profiles bp
    where bp.user_id = booster_services.booster_id
      and bp.status = 'approved'
  )
);
create policy "booster_services_owner_insert" on public.booster_services
for insert
with check (booster_id = auth.uid());
create policy "booster_services_owner_update" on public.booster_services
for update
using (booster_id = auth.uid())
with check (booster_id = auth.uid());
create policy "booster_services_owner_delete" on public.booster_services
for delete
using (booster_id = auth.uid());

-- Admin-only view can safely be invoker because duo_accounts_read already
-- permits admins and the view itself keeps the admin predicate.
alter view public.admin_duo_accounts set (security_invoker = true);
