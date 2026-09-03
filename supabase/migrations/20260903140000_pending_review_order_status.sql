-- Novo status pending_review: janela de 1 minuto entre o pedido ficar pago
-- (ou credenciais enviadas) e ele de fato cair na aba de pedidos dos
-- boosters/anunciar no Discord -- dá tempo do admin travar, cancelar ou
-- atribuir a um booster específico antes da visibilidade pública. Valor de
-- enum isolado em sua própria migration -- Postgres não permite usar um
-- valor recém-adicionado na mesma transação que o criou (ver migration 110).
alter type public.order_status add value 'pending_review' before 'awaiting_assignment';
