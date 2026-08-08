-- Operational maintenance for the linked Supabase database.
--
-- Use after large test-data refreshes through `supabase db query`.
--
-- The Supabase Management API runs SQL files inside a transaction, so VACUUM
-- is intentionally not included here. Run VACUUM from a direct psql session or
-- the Dashboard SQL editor if needed.
--
-- This is not a migration and does not change tables, policies, functions or
-- application data.

analyze public.audit_logs;
analyze public.booster_applications;
analyze public.booster_profiles;
analyze public.booster_services;
analyze public.customer_profiles;
analyze public.duo_accounts;
analyze public.edge_rate_limits;
analyze public.games;
analyze public.master_plus_pricing;
analyze public.notifications;
analyze public.order_drop_requests;
analyze public.order_messages;
analyze public.order_rank_verifications;
analyze public.order_status_history;
analyze public.orders;
analyze public.payments;
analyze public.payout_records;
analyze public.profiles;
analyze public.refunds;
analyze public.reviews;
analyze public.service_extras;
analyze public.services;
