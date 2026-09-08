-- Hoje riot_id do pedido só é gravado uma vez, na criação (StepPayment.tsx)
-- -- se o cliente digitar errado, não existe nenhum caminho para corrigir:
-- a sincronização de partidas fica pra sempre devolvendo "Conta Riot não
-- encontrada", sem nenhum campo pra ele mesmo arrumar isso. update_order_riot_id
-- dá esse caminho de volta ao cliente (ou admin, pra suporte), espelhando a
-- mesma validação de formato "Nome#TAG" de set_duo_own_riot_id (migration
-- 148) -- bloqueado depois que alguma partida já foi sincronizada (mesma
-- regra de reserve_duo_account: trocar de conta em pleno andamento seria
-- uma forma de burlar o progresso já contabilizado).
create or replace function public.update_order_riot_id(p_order_id uuid, p_riot_id text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_order record;
  v_trimmed text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, customer_id, status, wins_played, losses_played into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if v_order.status not in ('awaiting_payment', 'paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if (coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0)) > 0 and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'cannot_change_after_matches_played');
  end if;

  v_trimmed := btrim(coalesce(p_riot_id, ''));
  if length(v_trimmed) < 3 or length(v_trimmed) > 60
     or position('#' in v_trimmed) < 2
     or position('#' in v_trimmed) = length(v_trimmed) then
    return jsonb_build_object('success', false, 'error', 'invalid_riot_id');
  end if;

  update public.orders set riot_id = v_trimmed, updated_at = now() where id = p_order_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (
    auth.uid(), (case when public.is_admin() then 'admin' else 'customer' end)::public.user_role,
    'order.riot_id_updated', 'order', p_order_id::text, jsonb_build_object('riot_id', v_trimmed)
  );

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.update_order_riot_id(uuid, text) from public, anon;
grant execute on function public.update_order_riot_id(uuid, text) to authenticated;
