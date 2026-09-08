-- Mesmo bug já documentado em migrations_archive/150 (duo_own_riot_id):
-- migration 20260906230000 adicionou orders.duo_current_rank mas esqueceu do
-- grant select column-level pra `authenticated` -- essa tabela usa grants
-- por coluna (ver 036_order_credentials_backend_hardening.sql, que revogou
-- o select geral), então qualquer select direto (não-RPC, sem service role)
-- que projete essa coluna falha por completo com "permission denied for
-- column duo_current_rank", não só a coluna nova vindo undefined.
--
-- É exatamente o que sync-order-matches faz: carrega o pedido com o JWT do
-- próprio usuário (userClient, não supabaseAdmin) selecionando
-- duo_current_rank -- daí o botão "Sincronizar" no histórico de partidas
-- falhando com "Falha ao carregar o pedido para sincronizar" pra
-- cliente/booster/admin, sempre. cron-sync-order-matches não é afetado
-- (usa supabaseAdmin/service_role, que ignora grants de coluna).
grant select (duo_current_rank)
  on public.orders to authenticated;
