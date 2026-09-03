-- Cupom de desconto no pedido. coupon_code é só o código informativo/auditoria
-- (o que o cliente digitou, já normalizado); discount_price é o valor em R$
-- efetivamente abatido do subtotal. Nenhum dos dois é gravado a partir de
-- confiança no cliente -- ambos vêm sempre do retorno de computeOrderPrice()
-- (shared/pricing.ts), chamado só depois de validateAndPriceIntent recompor
-- o pedido inteiro server-side (create-pix-payment). O cliente nunca envia
-- percentual nem valor de desconto, só o código do cupom dentro do intent.
alter table public.orders
  add column coupon_code text,
  add column discount_price numeric(10,2) not null default 0;

-- total_price = base_price + extras_price - discount_price ainda precisa
-- fechar exatamente -- só estende a identidade original (migration 007) pra
-- incluir o novo termo, mesma garantia de que o valor cobrado no PIX nunca
-- diverge da soma gravada em `orders`.
alter table public.orders
  drop constraint if exists orders_prices_nonnegative,
  drop constraint if exists orders_price_sum;

alter table public.orders
  add constraint orders_prices_nonnegative
    check (base_price >= 0 and extras_price >= 0 and discount_price >= 0 and total_price >= 0) not valid,
  add constraint orders_price_sum
    check (total_price = round(base_price + extras_price - discount_price, 2)) not valid;

alter table public.orders validate constraint orders_prices_nonnegative;
alter table public.orders validate constraint orders_price_sum;
