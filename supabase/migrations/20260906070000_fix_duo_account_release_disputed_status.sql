-- Bug: trg_fn_release_duo_account_on_order_end libera a reserva de
-- duo_accounts em completed/canceled/refunded mas omite 'disputed', enquanto
-- clear_terminal_order_credentials já trata 'disputed' como status terminal.
-- Um chargeback aberto no meio de um boost deixa a conta duo presa
-- reservada indefinidamente, mesmo o pedido nunca mais voltando a rodar.
--
-- Fix: adicionar 'disputed' à lista de status terminais deste trigger.
create or replace function public.trg_fn_release_duo_account_on_order_end()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status in ('completed', 'canceled', 'refunded', 'disputed') and old.status is distinct from new.status then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = reserved_by, last_released_at = now()
    where reserved_order_id = new.id;
  end if;
  return new;
end;
$function$;
