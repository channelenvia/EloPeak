-- Reembolso duplicado: o admin registra um reembolso manual (PIX devolvido por
-- fora, ou cartão estornado) e depois o Mercado Pago avisa o mesmo estorno por
-- webhook. process_mp_payment_event insere uma segunda linha em public.refunds
-- (valor cheio do pedido), e o total reembolsado do pedido fica em dobro.
--
-- O caminho inverso já é bloqueado: admin_create_manual_refund recusa com
-- 'already_refunded' quando a soma de refunds cobre o valor pago.
--
-- Trigger em vez de reescrever process_mp_payment_event (função grande, com
-- risco de divergir da versão em produção): toda linha de reembolso vinda do
-- provedor desconta o que já foi registrado manualmente no pedido -- some se
-- já foi tudo, ou grava só o restante. Webhook e reembolso manual travam a
-- mesma linha de orders (for update), então a checagem não corre em paralelo.

create or replace function public.dedupe_provider_refund_after_manual()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual numeric;
begin
  if coalesce(new.is_manual, false) then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_manual
  from public.refunds
  where order_id = new.order_id and is_manual;

  if v_manual <= 0 then
    return new;
  end if;

  if v_manual >= new.amount then
    return null;
  end if;

  new.amount := new.amount - v_manual;
  return new;
end;
$$;

revoke all on function public.dedupe_provider_refund_after_manual() from public, anon, authenticated;

drop trigger if exists trg_refunds_dedupe_provider_after_manual on public.refunds;
create trigger trg_refunds_dedupe_provider_after_manual
before insert on public.refunds
for each row execute function public.dedupe_provider_refund_after_manual();
