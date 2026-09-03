-- Bug real de produção: 036_order_credentials_backend_hardening.sql revogou
-- select(*) em public.orders e regrantou apenas uma lista explícita de
-- colunas para authenticated. match_sync_started_at e last_match_synced_at
-- (adicionadas depois, pro sync automático de partidas) nunca entraram nessa
-- lista. Pedir uma coluna sem grant faz o PostgREST rejeitar a query inteira
-- com 403 — por isso a aba "Meus Pedidos" parava de carregar pedidos do
-- próprio cliente (RLS batia certo, faltava o grant de coluna).
grant select (match_sync_started_at, last_match_synced_at) on public.orders to authenticated;
