-- reassigned_by_admin já tinha UPDATE/INSERT pra authenticated (accept_
-- boost_order/admin_reassign_booster escrevem nela via RPC security definer)
-- mas nunca teve SELECT -- o front-end (OrderDetail admin/cliente,
-- JobDetail/AvailableJobs do booster) precisa ler essa coluna direto pra
-- mostrar o badge roxo "Reatribuído" em vez do amarelo "Exclusivo". Sem
-- este grant, incluir a coluna em ORDER_SAFE_COLUMNS quebra toda query de
-- pedido pra authenticated com "permission denied for column".
grant select (reassigned_by_admin) on public.orders to authenticated;
