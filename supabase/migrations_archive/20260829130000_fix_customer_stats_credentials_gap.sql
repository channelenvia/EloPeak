-- Bug real: trg_fn_order_paid_customer_stats() só incrementa
-- customer_profiles.total_orders/total_spent quando a transição é
-- EXATAMENTE awaiting_payment -> awaiting_assignment. Mas
-- process_mp_payment_event (webhook do Mercado Pago) manda o pedido pra
-- 'awaiting_customer' em vez de 'awaiting_assignment' sempre que o serviço
-- exige credenciais da conta (order_requires_access_token -- hoje isso
-- cobre elo_boost/win_boost/md5 solo, ver 039_credentials_only_solo_wins_md5).
-- Esses pedidos pagos nunca batem a condição do trigger -- nem depois,
-- quando o cliente envia as credenciais e o pedido finalmente vai pra
-- awaiting_assignment (release_paid_order_after_credentials), porque nesse
-- ponto OLD.status é 'awaiting_customer', não 'awaiting_payment'. Resultado:
-- qualquer pedido pago que passe por awaiting_customer nunca é contado --
-- o cliente do relato tinha 8 pedidos pagos somando R$36,80, mas
-- customer_profiles mostrava 1 pedido de R$0,10 (o único que não passou
-- por awaiting_customer).
--
-- Fix: trocar a condição de "status chegou em X vindo de Y" (frágil a
-- qualquer novo destino pós-pagamento) por "payment_status acabou de virar
-- 'paid'" -- dispara exatamente uma vez por pedido, não importa por qual
-- status ele passe depois. A trigger já é AFTER UPDATE OF status, e
-- process_mp_payment_event sempre seta status junto com payment_status na
-- mesma instrução (mesmo quando o destino é awaiting_customer), então
-- continua dependendo do trigger existente, só a condição interna muda.
-- release_paid_order_after_credentials (awaiting_customer -> awaiting_assignment)
-- não toca payment_status (já é 'paid' antes), então não dispara o
-- incremento de novo -- sem risco de contar o mesmo pedido duas vezes.

create or replace function public.trg_fn_order_paid_customer_stats()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if NEW.payment_status = 'paid'::public.payment_status
     and OLD.payment_status is distinct from 'paid'::public.payment_status then
    update public.customer_profiles
      set total_orders = total_orders + 1,
          total_spent  = total_spent + NEW.total_price
      where user_id = NEW.customer_id;
  end if;

  -- Reverses the increment above when a previously-counted order (i.e. one
  -- that had already moved past draft/awaiting_payment, so it was actually
  -- added to the totals at some point) ends up canceled or refunded.
  -- OLD.status not in (..., 'canceled', 'refunded') also guards against
  -- ever reversing the same order's contribution twice.
  if NEW.status in ('canceled', 'refunded')
     and OLD.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded') then
    update public.customer_profiles
      set total_orders = greatest(0, total_orders - 1),
          total_spent  = greatest(0, total_spent - NEW.total_price)
      where user_id = NEW.customer_id;
  end if;

  return NEW;
end;
$$;

-- Backfill: recalcula total_orders/total_spent de TODOS os clientes a
-- partir do estado real de orders (mesma regra que o trigger corrigido
-- mantém daqui pra frente: conta tudo que não é draft/awaiting_payment/
-- canceled/refunded), corrigindo os totais já corrompidos pelo bug acima.
with real_stats as (
  select customer_id, count(*) as cnt, coalesce(sum(total_price), 0) as sum_price
  from public.orders
  where status not in ('draft', 'awaiting_payment', 'canceled', 'refunded')
  group by customer_id
)
update public.customer_profiles cp
set total_orders = coalesce(rs.cnt, 0),
    total_spent = coalesce(rs.sum_price, 0)
from real_stats rs
where rs.customer_id = cp.user_id
  and (cp.total_orders is distinct from rs.cnt or cp.total_spent is distinct from rs.sum_price);

update public.customer_profiles cp
set total_orders = 0, total_spent = 0
where (cp.total_orders <> 0 or cp.total_spent <> 0)
  and not exists (
    select 1 from public.orders o
    where o.customer_id = cp.user_id
      and o.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded')
  );
