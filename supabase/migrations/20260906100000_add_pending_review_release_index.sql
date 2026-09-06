-- Bug (LOW, perf): release_pending_review_orders varre orders sem nenhum
-- índice parcial/composto cobrindo
-- status='pending_review' AND admin_review_locked=false AND review_release_at<=now()
-- -- só existe um btree simples de status, então essa função (chamada por
-- cron) faz seq scan crescente conforme a tabela orders cresce.
--
-- Fix: índice parcial em review_release_at pros pedidos elegíveis pra
-- liberação automática.
create index if not exists orders_pending_review_release_idx
  on public.orders (review_release_at)
  where status = 'pending_review' and admin_review_locked = false;
