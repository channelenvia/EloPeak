-- Refresh test data in the linked Supabase project.
--
-- Preserves catalog/config tables needed by the app:
-- public.games, public.services, public.service_extras, public.master_plus_pricing
--
-- Clears volatile/test data:
-- auth users, profiles, orders, payments, payouts, reviews,
-- notifications, logs, booster/customer data, Discord/duo runtime data,
-- rank verification records and rate-limit rows.
--
-- Do not turn this into a migration. This is an operational test reset script.

begin;

truncate table
  public.audit_logs,
  public.notifications,
  public.reviews,
  public.refunds,
  public.payments,
  public.payout_records,
  public.order_drop_requests,
  public.order_messages,
  public.order_rank_verifications,
  public.order_status_history,
  public.orders,
  public.booster_services,
  public.booster_profiles,
  public.customer_profiles,
  public.duo_accounts,
  public.edge_rate_limits
restart identity cascade;

delete from auth.users;

commit;
