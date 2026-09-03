-- orders.idempotency_key era opcional: create-pix-payment (Edge Function)
-- validava (z.string().uuid().optional()) e só protegia contra pedido
-- duplicado quando o cliente de fato enviava a chave. Toda criação de pedido
-- passa exclusivamente por essa Edge Function com a service-role key (não
-- existe policy de INSERT em orders para anon/authenticated), então é seguro
-- tornar a coluna obrigatória no banco -- a garantia deixa de depender do
-- client sempre lembrar de mandar a chave.

update public.orders
set idempotency_key = gen_random_uuid()
where idempotency_key is null;

alter table public.orders
  alter column idempotency_key set not null,
  alter column idempotency_key set default gen_random_uuid();

comment on column public.orders.idempotency_key is
  'Obrigatória. Gerada pelo cliente (recomendado) ou pelo default do banco. '
  'Par único (customer_id, idempotency_key) via orders_customer_idempotency_idx '
  '-- ver create-pix-payment: um segundo insert com a mesma chave sempre '
  'reaproveita o pedido existente em vez de criar um novo.';
