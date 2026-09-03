-- Realtime apenas entrega eventos de tabelas incluídas na publicação.
-- O frontend ainda consulta available_boost_orders antes de avisar, portanto
-- RLS, exclusividade e exigência de credenciais continuam autoritativas.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end;
$$;
