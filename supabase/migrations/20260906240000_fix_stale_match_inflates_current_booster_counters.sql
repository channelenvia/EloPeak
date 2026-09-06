-- Bug (CRITICAL, financeiro): record_order_match incrementa
-- orders.wins_played/losses_played pra QUALQUER partida inserida, sem checar
-- se ela pertence à janela de atribuição ATUAL do pedido (order_booster_
-- assignments, ver migration 20260829030000). v_booster_id já resolve o
-- booster CERTO por played_at (pro histórico/stats), mas o incremento no
-- pedido ignora esse resultado e sempre atualiza o contador do booster
-- atribuído NO MOMENTO DO SYNC.
--
-- Efeito prático: pedido com booster1, ele perde 1 partida ainda não
-- sincronizada. Um drop roda antes do sync (zera wins_played/losses_played e
-- abre uma nova janela pro booster2). Quando o sync finalmente roda, a
-- partida antiga (played_at dentro da janela JÁ FECHADA de booster1) é
-- gravada com booster_id = booster1 (correto, via booster_assigned_at), mas
-- losses_played do pedido é incrementado mesmo assim -- inflando a contagem
-- da janela ATUAL de booster2. Se booster2 perde 1 partida de verdade depois,
-- o painel mostra 2 derrotas (1 de booster1 vazando pra janela errada + 1
-- real de booster2), e apply_order_drop cobra o penalty de 2 derrotas de
-- quem estiver assinado no momento do drop, mesmo que só 1 derrota seja
-- realmente dele.
--
-- Fix: só incrementa wins_played/losses_played quando v_booster_id (o
-- booster resolvido pela janela de atribuição, dono de verdade da partida)
-- é o mesmo assigned_booster_id atual do pedido. Partida de uma janela já
-- fechada continua sendo gravada em order_matches (histórico e stats do
-- booster antigo intactos), só não mexe mais no contador do pedido que
-- pertence a outra atribuição.
create or replace function public.record_order_match(
  p_order_id uuid,
  p_external_match_id text,
  p_result text,
  p_champion text,
  p_kills integer,
  p_deaths integer,
  p_assists integer,
  p_queue_id integer,
  p_duration_seconds integer,
  p_played_at timestamptz,
  p_minions_killed integer,
  p_neutral_minions_killed integer,
  p_is_mvp boolean,
  p_vision_score integer,
  p_duo_participated boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss', 'remake') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  if v_order.boost_mode = 'duo' and p_result <> 'remake' and not coalesce(p_duo_participated, false) then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'duo_not_participated');
  end if;

  v_booster_id := coalesce(public.booster_assigned_at(p_order_id, p_played_at), v_order.assigned_booster_id);

  insert into public.order_matches(
    order_id, booster_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, v_booster_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  -- Só conta pro progresso/penalidade do pedido ATUAL se a partida é mesmo
  -- da janela de atribuição em aberto -- senão pertence a um booster que já
  -- foi desassociado (drop/reassign), e o contador que a penalidade de drop
  -- lê (apply_order_drop) não é dele.
  if v_inserted and v_booster_id = v_order.assigned_booster_id then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    elsif p_result = 'loss' then
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;

revoke all on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) to service_role;
