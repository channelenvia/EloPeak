select
  c.relname as view_name,
  coalesce(c.reloptions::text, '{}') as reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in ('admin_duo_accounts', 'available_boost_orders', 'public_booster_profiles')
order by c.relname;
