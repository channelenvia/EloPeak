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
