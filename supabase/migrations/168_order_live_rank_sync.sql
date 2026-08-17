-- orders.current_rank hoje é só uma foto tirada na criação do pedido (ou
-- reescrita manualmente num drop, ver rank_before_last_drop) -- nunca
-- acompanha o progresso real do cliente durante o boost. Isso alimenta o
-- filtro de +-1 divisão de contas duo reserváveis pelo booster
-- (DuoAccountSection/withinDuoRankWindow), que ficava girando em cima de um
-- rank cada vez mais desatualizado conforme o pedido avança. sync-order-
-- matches (roda a cada ~30min + botão manual, já consulta a Riot pra
-- partidas) passa a também reverificar o rank via League-V4 e chamar esta
-- RPC pra manter current_rank ao vivo -- mesma fonte de verdade que
-- verify-order-rank já usa, só que recorrente em vez de só na finalização.
-- tier/division são text (mesmo shape validado hoje só na camada de
-- aplicação via Zod -- current_rank nunca teve enum de banco).
create or replace function public.update_order_current_rank(
  p_order_id uuid,
  p_tier text,
  p_division text,
  p_lp integer
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.orders
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division, 'lp', p_lp)
  where id = p_order_id;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_order_current_rank(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.update_order_current_rank(uuid, text, text, integer) to service_role;
