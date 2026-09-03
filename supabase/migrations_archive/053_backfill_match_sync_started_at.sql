-- Pedidos que já estavam in_progress/paused/awaiting_customer antes da
-- migration 052 não têm match_sync_started_at (a coluna não existia ainda).
-- Sem isso, sync-order-matches não saberia a partir de quando considerar
-- partidas para esses pedidos. Backfill pela primeira transição para
-- in_progress no histórico; sem histórico, usa created_at como limite
-- seguro (mais amplo, mas nunca teria partida de fato contabilizada antes
-- da existência do próprio pedido).

update public.orders o
set match_sync_started_at = coalesce(
  (
    select min(h.created_at)
    from public.order_status_history h
    where h.order_id = o.id and h.to_status = 'in_progress'
  ),
  o.created_at
)
where o.status in ('in_progress', 'paused', 'awaiting_customer', 'completed', 'disputed')
  and o.match_sync_started_at is null;
