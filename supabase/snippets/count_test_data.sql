select 'auth.users' as table_name, count(*)::bigint as row_count from auth.users
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.customer_profiles', count(*) from public.customer_profiles
union all select 'public.booster_profiles', count(*) from public.booster_profiles
union all select 'public.booster_applications', count(*) from public.booster_applications
union all select 'public.booster_services', count(*) from public.booster_services
union all select 'public.orders', count(*) from public.orders
union all select 'public.order_messages', count(*) from public.order_messages
union all select 'public.order_status_history', count(*) from public.order_status_history
union all select 'public.order_drop_requests', count(*) from public.order_drop_requests
union all select 'public.order_rank_verifications', count(*) from public.order_rank_verifications
union all select 'public.payments', count(*) from public.payments
union all select 'public.payout_records', count(*) from public.payout_records
union all select 'public.refunds', count(*) from public.refunds
union all select 'public.reviews', count(*) from public.reviews
union all select 'public.notifications', count(*) from public.notifications
union all select 'public.audit_logs', count(*) from public.audit_logs
union all select 'public.duo_accounts', count(*) from public.duo_accounts
union all select 'public.edge_rate_limits', count(*) from public.edge_rate_limits
union all select 'public.games', count(*) from public.games
union all select 'public.services', count(*) from public.services
union all select 'public.service_extras', count(*) from public.service_extras
union all select 'public.master_plus_pricing', count(*) from public.master_plus_pricing
order by table_name;
