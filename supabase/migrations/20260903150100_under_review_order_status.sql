-- Novo status pro "centro de resolução": quando um pedido atinge o limite
-- de 2 drops, a 3ª tentativa cancela o pedido (não reabre pro pool) e cai
-- aqui em vez de 'refunded' -- nem o reembolso do cliente nem o eventual
-- ajuste de saldo do booster são automáticos, o admin resolve os dois na
-- tela "A analisar" (renomeada de "Reembolsos"). Valor de enum isolado em
-- sua própria migration -- Postgres não permite usar um valor recém-
-- adicionado na mesma transação que o criou (ver migration 110).
alter type public.order_status add value 'under_review' before 'refunded';
