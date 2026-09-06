-- Checkpoint de PDL/LP do lado DUO (conta do booster) dentro de um pedido,
-- espelhando orders.current_rank (que já rastreia o lado do cliente). Sem
-- isso, sync-order-matches não tinha onde persistir o snapshot de rank do
-- booster entre chamadas -- necessário pra resolver remakes comparando
-- PDL/LP antes/depois da partida em vez de confiar só em timePlayed (ver
-- fetchRankOrdinal/resolveMatchResult em riotLookup.ts).
alter table public.orders
  add column if not exists duo_current_rank jsonb;

create or replace function public.update_order_duo_current_rank(
  p_order_id uuid,
  p_tier text,
  p_division text,
  p_lp integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.orders
  set duo_current_rank = jsonb_build_object('tier', p_tier, 'division', p_division, 'lp', p_lp)
  where id = p_order_id;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_order_duo_current_rank(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.update_order_duo_current_rank(uuid, text, text, integer) to service_role;
