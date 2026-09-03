-- Duas correções pro fluxo de contagem de partidas em Duo Boost (mesmo
-- assunto da migration 20260824010000/sync-order-matches, achadas numa
-- revisão de código do próprio recurso):
--
--   1. A checagem "só conta em duo se a conta duo/booster participou" vivia
--      só dentro de sync-order-matches (edge function) -- record_order_match
--      contava incondicionalmente qualquer resultado inserido. Um caller
--      futuro diferente (ferramenta de admin, script de reconciliação)
--      poderia contar vitória/derrota de duo sem essa checagem, sem
--      nenhuma defesa no lado do banco. Move o gate pra dentro da própria
--      função: agora ela recebe p_duo_participated e se recusa a contar
--      partidas de pedido duo sem esse sinal.
--
--   2. Partidas duo que o cliente jogou sozinho (não contam, então) nunca
--      eram gravadas em lugar nenhum -- então nunca entravam no
--      "já processado" e o sync re-buscava a MESMA partida na Riot pra
--      sempre, a cada chamada (auto-sync roda a cada 30min). order_ignored_matches
--      guarda só o id da partida já verificada e descartada, sem duplicar
--      nenhum dado de order_matches nem afetar o que aparece no histórico
--      do cliente.

drop function if exists public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer);

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
  -- null é válido só quando o pedido não é duo (boost_mode != 'duo') -- o
  -- gate abaixo só olha esse parâmetro quando o pedido É duo.
  p_duo_participated boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  -- Em Duo Boost, o cliente joga PARTIDO com o booster (conta separada) --
  -- uma partida só conta pro progresso do pedido se a conta duo cadastrada
  -- de fato participou dela. Reforçado aqui (não só no chamador) pra
  -- nenhum caller futuro esquecer essa checagem -- o próprio banco recusa.
  if v_order.boost_mode = 'duo' and not coalesce(p_duo_participated, false) then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'duo_not_participated');
  end if;

  insert into public.order_matches(
    order_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  if v_inserted then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    else
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) to service_role;

-- Cache de "já verifiquei essa partida e ela não conta pro pedido" --
-- puramente interno (só sync-order-matches lê/escreve), sem exposição a
-- authenticated/anon. Sem isso, sync-order-matches re-busca a MESMA
-- partida da Riot em todo sync futuro (a cada 30min), pra sempre.
create table public.order_ignored_matches (
  order_id uuid not null references public.orders(id) on delete cascade,
  external_match_id text not null,
  ignored_at timestamptz not null default now(),
  primary key (order_id, external_match_id)
);

alter table public.order_ignored_matches enable row level security;

revoke all on public.order_ignored_matches from public, anon, authenticated;
grant select, insert on public.order_ignored_matches to service_role;
