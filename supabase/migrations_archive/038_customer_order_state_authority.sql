-- Centraliza no banco as decisões de checkout/pós-pagamento consumidas pelo
-- cliente. O navegador recebe apenas capacidades calculadas a partir da linha
-- real do pedido e da identidade autenticada; nenhum status/service_type vindo
-- do front é usado para autorizar pagamento ou credenciais.

create or replace function public.get_customer_order_state(
  p_order_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order record;
  v_requires_credentials boolean;
  v_is_active_paid boolean;
begin
  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_order_id is null then
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where customer_id = v_customer_id
      and status = 'awaiting_payment'
    order by created_at desc
    limit 1;

    if not found then
      return jsonb_build_object('success', true, 'order_id', null);
    end if;
  else
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where id = p_order_id
      and customer_id = v_customer_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'order_not_found');
    end if;
  end if;

  v_requires_credentials := public.order_requires_access_token(
    v_order.service_type,
    v_order.boost_mode
  );
  v_is_active_paid := v_order.payment_status = 'paid'::public.payment_status
    and v_order.status in (
      'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer'
    );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'can_pay', v_order.status = 'awaiting_payment'
      and coalesce(v_order.payment_status, 'pending'::public.payment_status) = 'pending'::public.payment_status,
    'payment_confirmed', v_is_active_paid,
    'requires_credentials', v_requires_credentials,
    'credentials_set', v_order.credentials_set,
    'can_submit_credentials', v_is_active_paid and v_requires_credentials
  );
end;
$$;

revoke all on function public.get_customer_order_state(uuid) from public, anon;
grant execute on function public.get_customer_order_state(uuid) to authenticated;
