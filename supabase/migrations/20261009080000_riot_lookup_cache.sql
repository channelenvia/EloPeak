-- H-27: cache curto (60-120 s) de consultas Riot por conta nos caminhos de checkout/preview.
-- So service_role (Edge) acessa; limpeza junto do prune diario.
create table if not exists public.riot_lookup_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  expires_at timestamptz not null
);
create index if not exists riot_lookup_cache_expires_idx on public.riot_lookup_cache (expires_at);
alter table public.riot_lookup_cache enable row level security;
revoke all on public.riot_lookup_cache from anon, authenticated;

select cron.schedule('prune-riot-lookup-cache', '30 4 * * *', $$delete from public.riot_lookup_cache where expires_at < now()$$);
