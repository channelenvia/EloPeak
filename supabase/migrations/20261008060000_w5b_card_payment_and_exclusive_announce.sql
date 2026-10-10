-- W5 (2/2): alinha record_card_payment com a Edge (p_method_type) e reabre o anuncio de exclusividade (H-12, H-24).
set search_path = public, extensions;

-- A Edge create-card-payment chama record_card_payment com p_method_type; a assinatura de 4 argumentos sai (sem overload orfao).
drop function public.record_card_payment(uuid, uuid, text, numeric);
create function public.record_card_payment(
  p_order_id uuid, p_customer_id uuid, p_mp_payment_id text, p_amount numeric, p_method_type text default 'credit_card'
) returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if p_method_type not in ('credit_card', 'debit_card') then
    raise exception 'invalid payment method type';
  end if;

  v_result := public.record_pix_payment(p_order_id, p_customer_id, p_mp_payment_id, p_amount);

  update public.payments
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('method', 'card'),
      payment_method_type = p_method_type
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id;

  return v_result;
end;
$function$;
revoke execute on function public.record_card_payment(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_card_payment(uuid, uuid, text, numeric, text) to service_role;

-- H-24: pedido reatribuido que expira de novo precisa ser anunciado de novo.
create or replace function public.trg_fn_reset_exclusive_announce()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.exclusive_until is not null and new.exclusive_until is distinct from old.exclusive_until then
    new.exclusive_expired_announced_at := null;
  end if;
  return new;
end;
$function$;
revoke execute on function public.trg_fn_reset_exclusive_announce() from public, anon, authenticated;
create trigger trg_orders_reset_exclusive_announce before update of exclusive_until on public.orders
  for each row execute function public.trg_fn_reset_exclusive_announce();
