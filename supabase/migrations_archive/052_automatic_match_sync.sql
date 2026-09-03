-- Remove o fluxo manual de resultado de partida (+1 Win / +1 Loss, um
-- booster podia digitar qualquer número) e cria a base para sincronização
-- automática via Riot Match-V5, chamada pelo booster (edge function
-- sync-order-matches, mesma forma da verify-order-rank já existente).
--
-- order_matches guarda cada partida já contabilizada, com constraint única
-- em (order_id, external_match_id) — garante idempotência mesmo que a
-- sincronização rode mais de uma vez sobre o mesmo intervalo.
--
-- match_sync_started_at marca quando o pedido entrou em andamento pela
-- primeira vez: partidas jogadas antes disso nunca são contabilizadas, nem
-- que o booster pause e retome depois.

create table public.order_matches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  external_match_id text not null,
  result text not null check (result in ('win', 'loss')),
  champion text,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  queue_id integer,
  duration_seconds integer,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (order_id, external_match_id)
);

create index order_matches_order_idx on public.order_matches(order_id, played_at desc);

alter table public.order_matches enable row level security;

create policy "order_matches_read" on public.order_matches for select using (
  public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.id = order_matches.order_id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  )
);

revoke all on public.order_matches from public, anon;
grant select on public.order_matches to authenticated;
grant insert, select, update, delete on public.order_matches to service_role;

alter table public.orders add column if not exists match_sync_started_at timestamptz;
alter table public.orders add column if not exists last_match_synced_at timestamptz;

-- Marca o início da janela de sincronização na primeira vez que o pedido
-- entra em andamento (idempotente: nunca sobrescreve um valor já setado, uma
-- pausa/retomada não reabre a janela).
create or replace function public.update_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_to_status public.order_status;
  v_allowed boolean := false;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    update public.orders set status = v_to_status, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, auth.uid(), coalesce(p_reason, 'Admin status update'));

    return jsonb_build_object('success', true);
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_allowed := case
    when v_order.status = 'assigned'          and v_to_status = 'in_progress' then true
    when v_order.status = 'in_progress'       and v_to_status in ('paused', 'awaiting_customer') then true
    when v_order.status = 'paused'            and v_to_status in ('in_progress', 'awaiting_customer') then true
    when v_order.status = 'awaiting_customer' and v_to_status in ('in_progress', 'paused') then true
    else false
  end;

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', 'invalid_transition');
  end if;

  if v_to_status = 'awaiting_customer'
     and v_order.wins_purchased is not null
     and v_order.wins_played < v_order.wins_purchased
  then
    return jsonb_build_object('success', false, 'error', 'objective_not_reached');
  end if;

  update public.orders set
    status = v_to_status,
    updated_at = now(),
    match_sync_started_at = case
      when v_order.status = 'assigned' and v_to_status = 'in_progress'
        then coalesce(match_sync_started_at, now())
      else match_sync_started_at
    end
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;

-- Registro idempotente de uma partida sincronizada. Só o service_role
-- (edge function sync-order-matches, que já verificou o resultado direto na
-- Riot) pode chamar — nenhuma vitória/derrota é aceita vinda do navegador.
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
  p_played_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  insert into public.order_matches(
    order_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at
  ) values (
    p_order_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at
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

-- Registra a tentativa de sincronização mesmo sem partidas novas — evita que
-- o booster fique sem saber se a sincronização já rodou.
create or replace function public.mark_order_match_sync(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set last_match_synced_at = now() where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_order_match_sync(uuid) from public, anon, authenticated;
grant execute on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.mark_order_match_sync(uuid) to service_role;

-- Fim do fluxo manual: nenhum caminho legítimo depende mais dele (ver
-- remoção do botão +1 Win / +1 Loss no painel do booster).
drop function if exists public.log_match_result(uuid, integer, integer);
