-- get_order_duo_account_history -- expõe ao cliente, ao booster dono do
-- pedido e ao admin o histórico de contas Duo associadas a um pedido, mais
-- recente primeiro. duo_account_reservations (migration 148) já guarda esse
-- histórico pra contas do pool da plataforma, mas a RLS ali é admin-only;
-- essa função (security definer) reabre isso pro cliente/booster do próprio
-- pedido, igual já é feito em get_order_duo_partner_riot_id (migration 169).
--
-- orders.duo_own_riot_id (conta própria do booster) não tem histórico
-- próprio -- é só um campo sobrescrito. Quando setado, entra como a entrada
-- mais recente da lista (reserved_at = null, sinaliza "conta própria atual"
-- pro frontend), na frente das reservas de pool que já têm timestamp real.
create or replace function public.get_order_duo_account_history(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order record;
  v_own_entry jsonb;
  v_history jsonb;
begin
  select customer_id, assigned_booster_id, boost_mode, duo_own_riot_id
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_order.customer_id is distinct from auth.uid()
     and v_order.assigned_booster_id is distinct from auth.uid()
     and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.boost_mode is distinct from 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;

  v_own_entry := case when v_order.duo_own_riot_id is not null then
    jsonb_build_array(jsonb_build_object(
      'riot_id', v_order.duo_own_riot_id,
      'own_account', true,
      'reserved_at', null,
      'released_at', null
    ))
  else '[]'::jsonb end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'riot_id', coalesce(d.riot_id, d.label),
    'own_account', false,
    'reserved_at', h.reserved_at,
    'released_at', h.released_at
  ) order by h.reserved_at desc), '[]'::jsonb)
  into v_history
  from public.duo_account_reservations h
  join public.duo_accounts d on d.id = h.account_id
  where h.order_id = p_order_id;

  return jsonb_build_object('success', true, 'history', v_own_entry || v_history);
end;
$$;

revoke all on function public.get_order_duo_account_history(uuid) from public, anon;
grant execute on function public.get_order_duo_account_history(uuid) to authenticated;
