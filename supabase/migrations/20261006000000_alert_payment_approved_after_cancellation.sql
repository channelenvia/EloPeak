-- Um pagamento pode ser aprovado no Mercado Pago depois de o pedido local ter
-- sido cancelado. process_mp_payment_event mantém corretamente o pedido em
-- canceled, mas antes não deixava nenhum sinal para a operação reconciliar o
-- dinheiro recebido. Este trigger observa a transição real do pagamento para
-- paid e cria um alerta in-app para todos os admins, sem reabrir o pedido.

create or replace function public.notify_admins_on_canceled_order_payment_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status public.order_status;
begin
  select status into v_order_status
  from public.orders
  where id = new.order_id;

  if v_order_status = 'canceled'::public.order_status
     and not exists (
       select 1
       from public.notifications
       where type = 'payment_approved_after_cancellation'
         and data->>'order_id' = new.order_id::text
     ) then
    insert into public.notifications(user_id, type, title, body, data)
    select
      id,
      'payment_approved_after_cancellation',
      'Pagamento aprovado após cancelamento',
      'O Mercado Pago aprovou o PIX do pedido ' || new.order_id::text
        || ' depois de o pedido já estar cancelado. O pedido não foi reaberto; reconcilie o recebimento e o eventual reembolso manualmente.',
      jsonb_build_object(
        'order_id', new.order_id,
        'payment_id', new.id,
        'mp_payment_id', new.mp_payment_id,
        'amount', new.amount
      )
    from public.profiles
    where role = 'admin';
  end if;

  return new;
end;
$$;

revoke all on function public.notify_admins_on_canceled_order_payment_approval()
  from public, anon, authenticated;

drop trigger if exists trg_notify_canceled_order_payment_approval on public.payments;
create trigger trg_notify_canceled_order_payment_approval
after update of status on public.payments
for each row
when (
  old.status is distinct from 'paid'::public.payment_status
  and new.status = 'paid'::public.payment_status
)
execute function public.notify_admins_on_canceled_order_payment_approval();
