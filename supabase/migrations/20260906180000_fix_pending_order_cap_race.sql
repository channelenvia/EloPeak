-- Bug (MEDIUM): o teto de "no máximo 2 pedidos awaiting_payment" por
-- cliente em create-pix-payment/index.ts é count-então-insert do lado da
-- edge function (não atômico) -- requests concorrentes do mesmo usuário
-- (ex. duas abas clicando "criar pedido" ao mesmo tempo) podem passar da
-- trava numa corrida clássica TOCTOU.
--
-- Fix: mover a garantia pro banco via trigger BEFORE INSERT com advisory
-- lock por cliente, igual ao padrão já usado em accept_boost_order pro lock
-- por booster -- serializa concorrência do mesmo customer_id sem exigir
-- reescrever toda a lógica de criação de pedido (validação/pricing/Riot)
-- numa RPC nova.
create or replace function public.trg_fn_cap_pending_orders()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  if new.status = 'awaiting_payment' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 1));

    select count(*) into v_count
    from public.orders
    where customer_id = new.customer_id and status = 'awaiting_payment';

    if v_count >= 2 then
      raise exception 'pending_order_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_cap_pending_orders on public.orders;
create trigger trg_cap_pending_orders
  before insert on public.orders
  for each row execute function public.trg_fn_cap_pending_orders();
