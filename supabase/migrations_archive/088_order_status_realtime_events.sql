-- Realtime de verdade (instantâneo) para mudança de status de pedido,
-- seguindo o mesmo padrão de segurança já usado em booster_order_events
-- (migration 042): nunca publica a linha inteira de orders no Realtime
-- (vazaria preço/notas/dados do cliente pra qualquer assinante daquele
-- canal), só um evento mínimo (order_id + status). O front usa o evento
-- só como gatilho pra invalidar e re-buscar via query normal, que já
-- respeita RLS -- nunca lê dado do payload do evento (mesmo padrão de
-- useRealtimeInvalidate).

create table public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  created_at timestamptz not null default now()
);

create index order_status_events_order_idx on public.order_status_events(order_id, created_at desc);

alter table public.order_status_events enable row level security;

create policy "order_status_events_read" on public.order_status_events for select using (
  public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.id = order_status_events.order_id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  )
);

revoke all on table public.order_status_events from public, anon;
grant select on table public.order_status_events to authenticated;
grant insert, select on table public.order_status_events to service_role;

create or replace function public.notify_order_status_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_events(order_id, status) values (new.id, new.status);
  end if;
  return new;
end;
$$;

revoke all on function public.notify_order_status_changed() from public, anon, authenticated;

create trigger trg_notify_order_status_changed
  after update of status on public.orders
  for each row execute function public.notify_order_status_changed();

alter publication supabase_realtime add table public.order_status_events;
