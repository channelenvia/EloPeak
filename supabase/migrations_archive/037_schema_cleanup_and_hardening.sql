-- Schema audit follow-up: indexes on unsupported FKs, validation of CHECK
-- constraints that were created NOT VALID, removal of redundant indexes and
-- orphaned objects, and a missing RLS gap on booster_applications.
--
-- Indexes use plain CREATE INDEX (not CONCURRENTLY) because each migration
-- runs inside a transaction under `supabase db push`, and CONCURRENTLY
-- cannot run inside a transaction block. If these tables already carry
-- meaningful production volume, consider running the CREATE INDEX
-- statements below manually with CONCURRENTLY instead of via this file.

-- ── Indexes on foreign keys with no supporting index ────────────────────
create index if not exists orders_chat_locked_by_idx on public.orders (chat_locked_by);
create index if not exists orders_booster_service_id_idx on public.orders (booster_service_id);
create index if not exists refunds_order_id_idx on public.refunds (order_id);
create index if not exists refunds_payment_id_idx on public.refunds (payment_id);
create index if not exists refunds_initiated_by_idx on public.refunds (initiated_by);
create index if not exists order_drop_requests_booster_id_idx on public.order_drop_requests (booster_id);
create index if not exists order_drop_requests_admin_id_idx on public.order_drop_requests (admin_id);
create index if not exists order_status_history_changed_by_idx on public.order_status_history (changed_by);
create index if not exists order_rank_verifications_requested_by_idx on public.order_rank_verifications (requested_by);
create index if not exists reviews_customer_id_idx on public.reviews (customer_id);
create index if not exists service_extras_service_id_idx on public.service_extras (service_id);
create index if not exists duo_accounts_created_by_idx on public.duo_accounts (created_by);
create index if not exists master_plus_pricing_updated_by_idx on public.master_plus_pricing (updated_by);
create index if not exists booster_applications_user_id_idx on public.booster_applications (user_id);

-- Booster's current-month earnings (booster/pages/Dashboard.tsx) and
-- refresh_top5_boosters() both filter on (assigned_booster_id,
-- status = 'completed') and range/group by completed_at — one partial
-- composite index covers both.
create index if not exists orders_booster_completed_at_idx
  on public.orders (assigned_booster_id, completed_at)
  where status = 'completed';

-- ── Validate CHECK constraints created NOT VALID at their origin ───────
-- Confirms no pre-existing row violates them. VALIDATE CONSTRAINT only
-- takes SHARE UPDATE EXCLUSIVE, so it doesn't block concurrent writes.
-- NOTE: if any of these fail, the whole migration rolls back (transactional
-- apply) — that's expected and means real data needs to be investigated
-- before this migration can be applied, not a bug in the migration itself.
alter table public.booster_services validate constraint booster_services_lanes_valid;
alter table public.booster_services validate constraint booster_services_price_nonnegative;
alter table public.booster_services validate constraint booster_services_specialties_valid;
alter table public.master_plus_pricing validate constraint master_plus_price_positive;
alter table public.order_messages validate constraint order_messages_content_length;
alter table public.orders validate constraint orders_match_counters_nonnegative;
alter table public.orders validate constraint orders_price_sum;
alter table public.orders validate constraint orders_prices_nonnegative;
alter table public.payments validate constraint payments_amount_positive;
alter table public.payments validate constraint payments_refund_range;
alter table public.payout_records validate constraint payout_amounts_nonnegative;
alter table public.refunds validate constraint refunds_amount_positive;
alter table public.reviews validate constraint reviews_content_length;
alter table public.service_extras validate constraint service_extras_modifiers_nonnegative;

-- ── Redundant indexes (duplicate the UNIQUE constraint's own index) ────
drop index if exists public.customer_profiles_user_id_idx;
drop index if exists public.payments_order_idx;
drop index if exists public.profiles_email_idx;

-- ── Orphaned objects ─────────────────────────────────────────────────────
-- moderate_review: the admin review-moderation panel was removed from the
-- UI; zero callers anywhere in src/** or supabase/functions/**.
drop function if exists public.moderate_review(uuid, boolean);

-- can_coach: already marked legacy in its own column comment — not read by
-- any query. Coaching eligibility comes from an active booster_services row
-- with service_type = 'coaching' (see CoachPackagePicker.tsx).
alter table public.booster_profiles drop column if exists can_coach;

-- game_slug: enum present on the remote database but never created by any
-- migration in this repo (untracked drift) and not used as any column's
-- type — games.slug and orders.game_id are plain text.
drop type if exists public.game_slug;

-- ── booster_applications: applicant couldn't read their own application ─
-- Only admin policies (select/update/delete, migration 031) and the
-- applicant's own INSERT policy existed — no SELECT for the applicant
-- themselves. Dormant gap today (nothing in src/** queries this table
-- directly yet), but a future "view my application status" feature would
-- silently return zero rows instead of erroring without this.
create policy "booster_applications_select_own"
on public.booster_applications
for select
to authenticated
using (user_id = auth.uid());
