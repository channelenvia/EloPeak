-- Bug: nada impede um cliente de comprar 2+ pedidos Clash simultâneos.
-- Clash é um evento único por conta Riot (só dá pra jogar UM Clash por vez) --
-- mas orders.clash_tier/clash_day (migration 111) não têm nenhuma trava de
-- unicidade, e o teto genérico em create-pix-payment (trg_cap_pending_orders)
-- só limita quantos pedidos "awaiting_payment" no total, de qualquer serviço,
-- não impede 2 Clash ativos ao mesmo tempo (ex.: um em awaiting_assignment e
-- outro recém pago). Sem essa trava o cliente pode acabar com dois boosters
-- comprando/reservando o mesmo dia de Clash pra ele, ou dois times cobrando
-- credenciais/Riot ID ao mesmo tempo.
--
-- Fix: mesmo padrão de trg_cap_pending_orders (trigger BEFORE INSERT +
-- advisory lock por cliente, atômico) -- bloqueia um INSERT de pedido Clash
-- novo se o cliente já tem outro pedido Clash em qualquer status não-terminal
-- (tudo exceto completed/canceled/refunded).
create or replace function public.trg_fn_cap_active_clash_orders()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing boolean;
begin
  if new.service_type = 'clash' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 2));

    select exists (
      select 1 from public.orders
      where customer_id = new.customer_id
        and service_type = 'clash'
        and status not in ('completed', 'canceled', 'refunded')
    ) into v_existing;

    if v_existing then
      raise exception 'active_clash_order_exists' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_cap_active_clash_orders on public.orders;
create trigger trg_cap_active_clash_orders
  before insert on public.orders
  for each row execute function public.trg_fn_cap_active_clash_orders();
