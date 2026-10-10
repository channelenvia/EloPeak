-- N-4: o coach marcava awaiting_customer sem gate e a auto-conclusao de 12 h pagava 70% do pacote se o cliente nao reagisse.
-- Coaching nao conclui sozinho (cliente confirma ou o admin decide); passadas 12 h os admins sao avisados uma unica vez.
create or replace function public.auto_complete_awaiting_customer_orders()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.id, o.customer_id
    from public.orders o
    where o.status = 'awaiting_customer'
      and o.service_type <> 'coaching'
      and o.assigned_booster_id is not null
      and o.payment_status = 'paid'
      and coalesce((select max(h.created_at) from public.order_status_history h
                    where h.order_id = o.id and h.to_status = 'awaiting_customer'), o.updated_at)
          <= now() - interval '12 hours'
    for update of o skip locked
  loop
    begin
      perform public._complete_order_by_customer(v_order.id, v_order.customer_id,
        'Conclusão automática: o cliente não respondeu em 12 h');
      insert into public.notifications(user_id, type, title, body, data)
      values (v_order.customer_id, 'order_auto_completed', 'Pedido concluído automaticamente',
              'Passaram 12 h sem resposta, então o pedido foi marcado como concluído.',
              jsonb_build_object('order_id', v_order.id));
      v_count := v_count + 1;
    exception when others then
      -- um pedido problematico nao pode travar o lote inteiro
      raise warning 'auto_complete_awaiting_customer_orders: pedido % falhou: %', v_order.id, sqlerrm;
    end;
  end loop;

  -- coaching parado em awaiting_customer ha 12 h+: avisa os admins uma vez por pedido
  insert into public.notifications(user_id, type, title, body, data)
  select p.id, 'coaching_awaiting_customer_stale', 'Coaching aguardando o cliente há mais de 12 h',
         'Pedido ' || o.id::text || ' de coaching não conclui sozinho. Fale com o cliente/coach e conclua ou abra disputa.',
         jsonb_build_object('order_id', o.id)
  from public.orders o
  cross join public.profiles p
  where p.role = 'admin'
    and o.status = 'awaiting_customer'
    and o.service_type = 'coaching'
    and o.assigned_booster_id is not null
    and o.payment_status = 'paid'
    and coalesce((select max(h.created_at) from public.order_status_history h
                  where h.order_id = o.id and h.to_status = 'awaiting_customer'), o.updated_at)
        <= now() - interval '12 hours'
    and not exists (select 1 from public.notifications n
                    where n.type = 'coaching_awaiting_customer_stale' and n.user_id = p.id and (n.data->>'order_id')::uuid = o.id);

  return v_count;
end;
$function$;
revoke execute on function public.auto_complete_awaiting_customer_orders() from public, anon, authenticated;
