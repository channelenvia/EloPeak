select
  count(*) filter (
    where p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) as anon_executable_security_definer_functions,
  count(*) filter (
    where not exists (
      select 1
      from pg_depend d
      where d.objid = p.oid
        and d.deptype = 'e'
    )
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) as public_project_functions_without_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

select
  c.relname as view_name,
  coalesce(c.reloptions::text, '{}') as reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in ('admin_duo_accounts', 'available_boost_orders', 'public_booster_profiles')
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'games',
    'services',
    'service_extras',
    'master_plus_pricing',
    'payments',
    'duo_accounts',
    'booster_services'
  )
order by tablename, policyname;
