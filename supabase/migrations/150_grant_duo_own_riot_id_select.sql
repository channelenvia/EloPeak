-- Migration 147 adicionou orders.duo_own_riot_id mas esqueceu do grant select
-- column-level pra `authenticated` (mesmo allow-list documentado na migration
-- 112) -- como duo_own_riot_id está em ORDER_SAFE_COLUMNS (usado por
-- listAdminOrders, listBoosterOrdersPage, getOrder, etc.), qualquer select
-- com essa projeção falhava por completo com "permission denied for table
-- orders" pra qualquer authenticated (admin, booster e cliente), não só a
-- coluna nova vindo undefined.
grant select (duo_own_riot_id)
  on public.orders to authenticated;
