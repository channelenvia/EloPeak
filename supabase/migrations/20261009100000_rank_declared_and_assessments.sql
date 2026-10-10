-- Elo declarado pelo cliente quando a Riot nao encontra rank (ou nao ha como consultar: MD5 = rank da temporada passada).
alter table public.orders
  add column if not exists rank_source text not null default 'riot'
  constraint orders_rank_source_check check (rank_source in ('riot', 'client_declared'));
grant select (rank_source) on public.orders to authenticated;

-- Avaliacao do proprio sistema (plausibilidade do elo declarado). Somente admin le; so a Edge (service_role) grava.
create table if not exists public.order_rank_assessments (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  status     text not null check (status in ('consistent', 'suspicious', 'inconclusive')),
  summary    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.order_rank_assessments enable row level security;
revoke all on public.order_rank_assessments from anon, authenticated;
grant select on public.order_rank_assessments to authenticated;
create policy order_rank_assessments_admin_read on public.order_rank_assessments
  for select to authenticated using (public.is_admin());
