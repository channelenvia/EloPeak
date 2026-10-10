-- L-12: policies criadas sem TO (roles={public}) em tabelas que o anon nem acessa passam a valer so para authenticated.
-- L-17: avaliacao exige booster_id definido (antes NULL = NULL passava pela checagem de dono).
do $$
declare
  r record;
begin
  for r in
    select c.relname, p.polname
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and p.polroles = '{0}'
      and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  loop
    execute format('alter policy %I on public.%I to authenticated', r.polname, r.relname);
  end loop;
end $$;

drop policy if exists reviews_customer_insert on public.reviews;
create policy reviews_customer_insert on public.reviews
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and booster_id is not null
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.customer_id = auth.uid()
        and o.status = 'completed'::public.order_status
        and o.assigned_booster_id = reviews.booster_id
    )
  );
