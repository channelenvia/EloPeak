-- Não publica a linha completa de orders no Realtime. O evento mínimo evita
-- expor campos do pedido que não são necessários para o alerta sonoro.
create table if not exists public.booster_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.booster_order_events enable row level security;

drop policy if exists "approved_boosters_read_order_events" on public.booster_order_events;
create policy "approved_boosters_read_order_events"
  on public.booster_order_events
  for select
  to authenticated
  using (public.is_approved_booster());

revoke all on table public.booster_order_events from public, anon, authenticated;
grant select on table public.booster_order_events to authenticated;

create or replace function public.notify_boosters_order_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'awaiting_assignment' then
    if tg_op = 'INSERT' then
      insert into public.booster_order_events (order_id) values (new.id);
    elsif old.status is distinct from 'awaiting_assignment' then
      insert into public.booster_order_events (order_id) values (new.id);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_boosters_order_available() from public, anon, authenticated;

drop trigger if exists trg_notify_boosters_order_available on public.orders;
create trigger trg_notify_boosters_order_available
after insert or update of status on public.orders
for each row execute function public.notify_boosters_order_available();

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime drop table public.orders';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booster_order_events'
  ) then
    execute 'alter publication supabase_realtime add table public.booster_order_events';
  end if;
end;
$$;
