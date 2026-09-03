-- public.orders usa um allow-list explícito de colunas pro grant select de
-- `authenticated` (migration 036) -- qualquer coluna nova precisa ser
-- adicionada nele, senão a coluna existe no banco mas nenhum client
-- (browser) consegue lê-la via PostgREST, mesmo já tipada no frontend.
--
-- clash_tier/clash_day (migration 111) e coupon_code/discount_price
-- (migration 108) nunca foram adicionadas -- coupon_code/discount_price
-- ainda não são lidos por nenhuma tela (achado só nesta auditoria, sem
-- efeito visível ainda), mas clash_tier/clash_day JÁ são lidos direto de
-- `order.clash_tier`/`order.clash_day` em três telas (OrderDetail do
-- cliente, JobDetail do booster, OrderDetail do admin) via getOrder()
-- (src/api/orders/queries.ts, select(ORDER_SAFE_COLUMNS) contra `orders`) --
-- sem este grant, a coluna nunca é devolvida e o bloco de Clash fica
-- silenciosamente vazio (sem erro, `order.clash_tier` só vem `undefined`).
grant select (coupon_code, discount_price, clash_tier, clash_day)
  on public.orders to authenticated;
