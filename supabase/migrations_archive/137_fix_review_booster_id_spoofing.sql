-- Bug real de integridade: a policy de INSERT em `reviews` (001_initializing.sql)
-- valida que o pedido é do cliente e está 'completed', mas nunca confere que
-- `booster_id` da linha inserida é de fato o `assigned_booster_id` daquele
-- pedido. Como não existe hoje nenhuma tela de "deixar avaliação" no
-- frontend (src/api/reviews só lê), isso nunca foi explorado pela UI -- mas
-- qualquer chamada direta à API REST do Supabase (poder-se ia inserir uma
-- review com o UUID de QUALQUER booster) conseguiria hoje plantar uma
-- avaliação (nota 1 ou 5) num booster que nunca atendeu aquele pedido,
-- contaminando average_rating/rating_count (refresh_booster_rating) e
-- booster_performance_segments -- ambos recalculados automaticamente pelo
-- trigger reviews_refresh_booster_rating a cada insert.
--
-- Fix: booster_id da linha precisa bater com orders.assigned_booster_id do
-- mesmo pedido (ou ser null, caso o produto algum dia aceite avaliação sem
-- booster atribuído -- não é o caso hoje, já que a policy já exige pedido
-- 'completed', que sempre tem assigned_booster_id preenchido).

drop policy if exists "reviews_customer_insert" on public.reviews;

create policy "reviews_customer_insert" on public.reviews for insert with check (
  customer_id = auth.uid()
  and exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.customer_id = auth.uid()
      and o.status = 'completed'
      and o.assigned_booster_id is not distinct from booster_id
  )
);
