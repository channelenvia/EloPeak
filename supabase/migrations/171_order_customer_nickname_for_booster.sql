-- 171_order_customer_nickname_for_booster.sql
-- A aba de detalhes do pedido do booster ganha um campo "Cliente" (nickname
-- de quem contratou), no mesmo espírito do "Booster associado" que o cliente
-- já vê no pedido dele. profiles só permite SELECT da própria linha ou admin
-- (profiles_read_own), então o booster não consegue ler profiles.username do
-- cliente direto -- precisa de uma função SECURITY DEFINER com autorização
-- restrita ao booster atribuído a ESTE pedido (ou admin), mesmo padrão de
-- get_order_duo_partner_riot_id (migration 169).

create or replace function public.get_order_customer_nickname(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_username text;
begin
  select customer_id, assigned_booster_id into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  if v_order.assigned_booster_id is distinct from auth.uid() and not public.is_admin() then
    return null;
  end if;

  select username into v_username from public.profiles where id = v_order.customer_id;
  return v_username;
end;
$$;

revoke all on function public.get_order_customer_nickname(uuid) from public, anon;
grant execute on function public.get_order_customer_nickname(uuid) to authenticated;
