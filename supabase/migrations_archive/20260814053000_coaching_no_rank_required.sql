-- orders_current_rank_required_check só isentava 'clash' da exigência de
-- current_rank -- mas coaching (e placement_matches, mesmo shape de schema
-- em orderPricing.ts::otherServiceIntentSchema) também não usa rank nenhum
-- por design: a validação de negócio em orderPricing.ts REJEITA current_rank
-- não-nulo pra coaching ("Ranks e vitórias não são aceitos em Coaching").
-- Resultado: todo insert de pedido de coaching violava essa constraint e
-- create-pix-payment devolvia 500 "Failed to create order" -- confirmado
-- reproduzindo o insert real contra o banco (erro 23514 nessa constraint
-- exata). Nenhum pedido de coaching jamais foi criado por causa disso.

alter table public.orders drop constraint orders_current_rank_required_check;
alter table public.orders add constraint orders_current_rank_required_check
  check (service_type in ('clash', 'coaching', 'placement_matches') or current_rank is not null);
