-- useRealtimeInvalidate (src/api/core/realtime.ts) subscribes to
-- postgres_changes on 9 tables across the app, but only order_status_events
-- and booster_order_events (migrations 088, 042/051) were ever added to the
-- supabase_realtime publication. The other 7 subscriptions were silently
-- inert -- Realtime never sends an event for a table outside the
-- publication, no error, nothing -- leaving only each hook's 15-30s
-- refetchInterval fallback to eventually pick up the change. That's the
-- root cause of "preciso dar F5 pra ver o chat/status atualizar".
--
-- orders itself stays deliberately OUT of the publication (migration 042/088
-- comment: publishing the full row would leak price/customer notes to any
-- open channel) -- that's why order status has its own minimal event table
-- instead. The 7 tables below don't have that problem: each already has RLS
-- (verified: all `enable row level security`, migration 001) scoping every
-- row to exactly the customer/booster/admin who's allowed to see it via the
-- app's normal .select() calls, and Supabase Realtime enforces that same RLS
-- for postgres_changes subscribers -- publishing the row itself is no wider
-- than what a plain query already returns to that user.
do $$
declare
  t text;
begin
  foreach t in array array[
    'order_messages', 'order_coaching_topics', 'notifications', 'payout_requests',
    'order_drop_requests', 'payments', 'refunds'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
