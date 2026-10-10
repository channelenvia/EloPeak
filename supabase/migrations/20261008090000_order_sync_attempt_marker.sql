-- M-28: o cron de sync ordena/filtra pela ultima TENTATIVA, nao so pelo ultimo sync que deu certo. Um pedido com Riot ID
-- errado/renomeado nunca sincroniza e ficava para sempre no topo da fila, esgotando os slots do tick.
alter table public.orders add column last_match_sync_attempt_at timestamptz;
create index orders_sync_attempt_idx on public.orders (last_match_sync_attempt_at nulls first)
  where status in ('in_progress', 'paused', 'drop_requested') and riot_id is not null;
