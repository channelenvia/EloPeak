-- Duas coisas nesta migration, achadas investigando "partidas do booster não
-- contam pro perfil dele":
--
--   1. BUG CRÍTICO AO VIVO (mesma classe do apply_order_drop, migration
--      20260827110000): record_order_match tinha duas sobrecargas.
--      20260824020000 criou a versão de 15 parâmetros (com
--      p_duo_participated, o gate de duo). 20260828110000 tentou adicionar
--      booster_id ao INSERT, mas usou CREATE OR REPLACE com uma lista de 14
--      parâmetros (sem p_duo_participated) -- isso NÃO substitui a função
--      existente, cria uma sobrecarga nova. sync-order-matches sempre chama
--      com 15 argumentos (inclui p_duo_participated), então só a versão de
--      15 parâmetros -- a ANTIGA, sem booster_id no INSERT -- é de fato
--      executada. Resultado prático: toda partida de Solo Boost gravada
--      desde 24/08 tem order_matches.booster_id = null, e
--      refresh_booster_performance_segments filtra
--      "where m.booster_id is not null" -- essas partidas nunca entram no
--      desempenho do booster. A sobrecarga de 14 parâmetros de 28/08 nunca
--      chegou a rodar de verdade.
--
--      Fix: dropa a sobrecarga órfã de 14 parâmetros e recria a única versão
--      real (15 parâmetros) já com booster_id no INSERT.
--
--   2. Atribuição de booster ainda dependia de "quem tá atribuído QUANDO O
--      SYNC RODA", não de quem estava atribuído quando a partida foi
--      REALMENTE jogada -- se o sync atrasa (roda a cada 30min ou só quando
--      alguém abre a tela) e o booster troca no meio do caminho, a partida
--      jogada pelo antigo é creditada ao novo quando finalmente sincroniza.
--      Fix: nova tabela order_booster_assignments (janela de tempo por
--      booster por pedido) + helper booster_assigned_at(order_id,
--      played_at), usado tanto por record_order_match (solo) quanto pela
--      nova record_duo_match (duo, substitui o upsert direto que
--      sync-order-matches fazia em booster_duo_matches). Isso resolve a
--      atribuição pro sempre, não importa quanto o sync atrase --
--      refresh_booster_performance_segments não muda em nada, já agrupa
--      pelo booster_id gravado na linha.
--
--      admin_drop_order ganha a mesma trava de sync recente que
--      request_order_drop/admin_reassign_booster já têm -- não é sobre
--      atribuição (a tabela de janelas já resolve isso), é sobre o
--      pagamento proporcional no drop não ficar sub-contado por partidas
--      jogadas mas ainda não sincronizadas.
--
--      Fora de escopo, documentado: não há como reconstruir com certeza o
--      booster_id de partidas JÁ gravadas erradas antes desta migration
--      (sem uma tabela de janelas que já existisse desde o início) -- só a
--      partir de agora fica garantidamente certo.

-- ── 1. Ledger de janelas de atribuição ──────────────────────────────────────

create table public.order_booster_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  booster_id uuid not null references public.booster_profiles(user_id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  created_at timestamptz not null default now()
);

create index order_booster_assignments_order_idx on public.order_booster_assignments(order_id, assigned_at desc);
-- No máximo uma janela aberta por pedido -- pega no ato qualquer bug futuro
-- que esqueça de fechar a janela antes de abrir outra.
create unique index order_booster_assignments_open_idx on public.order_booster_assignments(order_id) where unassigned_at is null;

alter table public.order_booster_assignments enable row level security;
revoke all on public.order_booster_assignments from public, anon, authenticated;

-- Backfill: uma janela aberta (assigned_at = -infinity) por pedido que já
-- tem booster hoje -- garante que booster_assigned_at resolve pra qualquer
-- played_at passado desses pedidos, não só daqui pra frente.
insert into public.order_booster_assignments (order_id, booster_id, assigned_at, unassigned_at)
select id, assigned_booster_id, '-infinity'::timestamptz, null
from public.orders
where assigned_booster_id is not null;

create or replace function public.booster_assigned_at(p_order_id uuid, p_played_at timestamptz)
returns uuid
language sql stable security definer set search_path = public as $$
  select booster_id
  from public.order_booster_assignments
  where order_id = p_order_id
    and assigned_at <= p_played_at
    and (unassigned_at is null or unassigned_at > p_played_at)
  order by assigned_at desc
  limit 1
$$;

revoke all on function public.booster_assigned_at(uuid, timestamptz) from public, anon, authenticated;

-- ── 2. Fix do overload órfão + record_duo_match nova ────────────────────────

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
  p_duo_participated boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss') then
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

  -- Em Duo Boost, o cliente joga PARTIDO com o booster (conta separada) --
  -- uma partida só conta pro progresso do pedido se a conta duo cadastrada
  -- de fato participou dela. Reforçado aqui (não só no chamador) pra
  -- nenhum caller futuro esquecer essa checagem -- o próprio banco recusa.
  if v_order.boost_mode = 'duo' and not coalesce(p_duo_participated, false) then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'duo_not_participated');
  end if;

  -- Quem estava REALMENTE atribuído quando a partida foi jogada (não quem
  -- está atribuído agora, no momento do sync) -- ver order_booster_assignments
  -- acima. Fallback pro atribuído atual só cobre o caso raro de a janela não
  -- ter sido aberta por algum motivo (nunca deveria acontecer daqui pra
  -- frente, mas evita gravar um booster_id null à toa).
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

-- Espelha record_order_match, mas grava em booster_duo_matches -- antes
-- sync-order-matches fazia esse upsert direto do edge function, com
-- booster_id = "atribuído agora"; passa a ir pela mesma resolução por
-- played_at, pelo mesmo motivo (ver cabeçalho da migration).
create or replace function public.record_duo_match(
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
  p_vision_score integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  v_booster_id := coalesce(public.booster_assigned_at(p_order_id, p_played_at), v_order.assigned_booster_id);
  if v_booster_id is null then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'no_booster_assigned');
  end if;

  insert into public.booster_duo_matches(
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

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.record_duo_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.record_duo_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer) to service_role;

-- ── 3. Backfill das partidas já gravadas com booster_id null pelo bug ──────
-- Mesma limitação documentada em 20260828110000: só temos o atribuído ATUAL
-- como referência, não há como saber quem estava atribuído no instante exato
-- de cada partida já sincronizada antes desta migration existir.
update public.order_matches m
set booster_id = coalesce(public.booster_assigned_at(m.order_id, m.played_at), o.assigned_booster_id)
from public.orders o
where o.id = m.order_id
  and m.booster_id is null
  and o.assigned_booster_id is not null;

-- ── 4. accept_boost_order: abre a janela de atribuição ao aceitar ─────────
create or replace function public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('accept_boost_order', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = p_order_id and dr.booster_id = p_booster_user_id and dr.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'previously_dropped_by_you');
  end if;
  if public.order_requires_access_token(v_order.service_type, v_order.boost_mode)
     and not v_order.credentials_set then
    return jsonb_build_object('success', false, 'error', 'missing_access_token');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.exclusive_until is not null
     and v_order.exclusive_until > now()
     and v_order.preferred_booster_id <> p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null
    and v_order.exclusive_until > now();

  if v_is_exclusive then
    if public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id, used_exclusive_slot = true,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido exclusivo');

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object('success', true, 'details', jsonb_build_object('used_exclusive_slot', true));
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
  where id = p_order_id;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;

-- ── 5. apply_order_drop: fecha a janela de atribuição ao dropar ───────────
create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order               record;
  v_completion_pct      numeric;
  v_completion_frac     numeric;
  v_is_top3             boolean;
  v_share_pct           numeric;
  v_payout              numeric;
  v_latest              record;
  v_new_current_rank    jsonb;
  v_new_total_price     numeric;
  v_new_estimated_hours numeric;
  v_new_wins_purchased  integer;
  v_price_changed       boolean;
  v_games_played        integer;
  v_bucket              text;
  v_fee_pct             numeric := 0;
  v_fee_amount          numeric := 0;
  v_warning_issued      boolean := false;
  v_light_loss_count    integer;
  v_prior_warnings      integer;
  v_new_warning_count   integer;
  v_new_blocked_until   timestamptz;
begin
  select id, service_type, total_price, current_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

  perform 1 from public.booster_profiles where user_id = v_order.assigned_booster_id for update;

  v_completion_pct  := public.order_drop_completion_pct(p_order_id);
  v_completion_frac := v_completion_pct / 100.0;
  v_price_changed   := v_completion_frac > 0;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  v_payout          := round(v_order.total_price * v_share_pct * v_completion_frac, 2);
  v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
  v_new_estimated_hours := case
    when v_order.estimated_hours is not null
      then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
    else null
  end;

  -- Só win_boost/md5 têm uma meta de vitórias -- reduz pela mesma fração
  -- de progresso aplicada ao preço, nunca abaixo de zero.
  v_new_wins_purchased := case
    when v_order.service_type in ('win_boost', 'md5') and v_order.wins_purchased is not null
      then greatest(0, v_order.wins_purchased - coalesce(v_order.wins_played, 0))
    else v_order.wins_purchased
  end;

  v_games_played := coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0);

  if v_order.losses_played > v_order.wins_played and v_order.losses_played >= 3 then
    v_bucket := 'heavy_loss';
    v_fee_pct := 0.10;
    v_warning_issued := true;

  elsif v_order.losses_played > v_order.wins_played then
    v_bucket := 'light_loss';

    select count(*) into v_light_loss_count
    from public.order_drop_requests
    where booster_id = v_order.assigned_booster_id
      and status = 'approved'
      and waived_at is null
      and penalty_bucket = 'light_loss'
      and resolved_at > now() - interval '30 days';

    if v_light_loss_count = 0 then
      v_fee_pct := 0; v_warning_issued := false;
    elsif v_light_loss_count = 1 then
      v_fee_pct := 0.05; v_warning_issued := false;
    else
      v_fee_pct := 0.05; v_warning_issued := true;
    end if;

  else
    v_bucket := 'tied_or_winning';
    if v_games_played <= 6 then
      v_fee_pct := 0; v_warning_issued := false;
    else
      v_fee_pct := 0; v_warning_issued := true;
    end if;
  end if;

  v_fee_amount := round(v_order.total_price * v_fee_pct, 2);

  v_new_current_rank := v_order.current_rank;
  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null then
    select fetched_tier, fetched_division into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;
    if v_latest.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest.fetched_tier, 'division', v_latest.fetched_division);
    end if;
  end if;

  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    total_price            = v_new_total_price,
    base_price             = case when v_price_changed then v_new_total_price else base_price end,
    extras_price           = case when v_price_changed then 0 else extras_price end,
    discount_price         = case when v_price_changed then 0 else discount_price end,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles
    set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial (' || round(v_completion_pct) || '% concluído) pelo pedido '
        || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'Você concluiu ' || round(v_completion_pct) || '% do pedido antes do drop -- R$ '
        || v_payout::text || ' foi creditado ao seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout, 'completion_pct', v_completion_pct)
    );
  end if;

  if v_fee_amount > 0 then
    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
      'Taxa de drop (' || round(v_fee_pct * 100) || '%) referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Uma taxa de ' || round(v_fee_pct * 100) || '% (R$ ' || v_fee_amount::text
        || ') foi descontada do seu saldo por dropar um pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_fee_amount, 'pct', v_fee_pct)
    );
  end if;

  if v_warning_issued then
    select count(*) into v_prior_warnings
    from public.order_drop_requests
    where booster_id = v_order.assigned_booster_id
      and status = 'approved'
      and waived_at is null
      and warning_issued = true
      and resolved_at > now() - interval '30 days';

    v_new_warning_count := v_prior_warnings + 1;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_warning_issued', 'Advertência de drop',
      'Você recebeu uma advertência (' || v_new_warning_count || '/5 ativas). '
        || 'Elas expiram 30 dias após serem geradas.',
      jsonb_build_object('order_id', p_order_id, 'active_warnings', v_new_warning_count)
    );

    if v_new_warning_count = 2 then
      v_new_blocked_until := now() + interval '6 hours';
    elsif v_new_warning_count = 3 then
      v_new_blocked_until := now() + interval '16 hours';
    end if;

    if v_new_blocked_until is not null then
      update public.booster_profiles
      set blocked_until = greatest(coalesce(blocked_until, v_new_blocked_until), v_new_blocked_until)
      where user_id = v_order.assigned_booster_id;

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.assigned_booster_id, 'booster_temporarily_blocked', 'Bloqueio temporário',
        'Você está impedido de pegar novos pedidos até '
          || to_char(v_new_blocked_until at time zone 'America/Sao_Paulo', 'HH24:MI DD/MM') || '.',
        jsonb_build_object('blocked_until', v_new_blocked_until)
      );
    end if;

    if v_new_warning_count = 5 then
      update public.booster_profiles set status = 'suspended'
      where user_id = v_order.assigned_booster_id;

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.assigned_booster_id, 'booster_auto_suspended', 'Conta suspensa',
        'Sua conta foi suspensa automaticamente após atingir 5 advertências ativas.',
        jsonb_build_object('active_warnings', v_new_warning_count)
      );
    end if;
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object(
    'completion_pct', v_completion_pct,
    'payout_amount', v_payout,
    'penalty_bucket', v_bucket,
    'penalty_fee_pct', v_fee_pct,
    'penalty_fee_amount', v_fee_amount,
    'warning_issued', v_warning_issued
  );
end;
$$;

-- ── 6. cancel_order_after_drop_limit: fecha a janela ao cancelar ──────────
create or replace function public.cancel_order_after_drop_limit(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_completion_pct numeric;
begin
  select id, customer_id, assigned_booster_id
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('completion_pct', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  update public.orders set
    status     = 'canceled',
    updated_at = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'canceled', p_actor_id, p_reason);

  if v_order.assigned_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_dropped_by_admin', 'Pedido cancelado pelo admin',
      'Este pedido atingiu o limite de 2 drops e foi cancelado por um administrador. Motivo: ' || p_reason
        || '. Nosso time vai falar com você individualmente sobre o pagamento.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido atingiu o limite de 2 drops e foi cancelado. Nosso time vai entrar em contato para resolver individualmente.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('completion_pct', v_completion_pct);
end;
$$;

revoke all on function public.cancel_order_after_drop_limit(uuid, text, uuid, text) from public, anon, authenticated;

-- ── 7. admin_reassign_booster: fecha a janela antiga, abre a nova ─────────
create or replace function public.admin_reassign_booster(
  p_order_id uuid,
  p_target_booster_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_target record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, last_match_synced_at
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_reassign');
  end if;
  if v_order.assigned_booster_id = p_target_booster_id then
    return jsonb_build_object('success', false, 'error', 'already_assigned_to_target');
  end if;

  select user_id, display_name into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;

  update public.orders
  set assigned_booster_id = p_target_booster_id, updated_at = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_target_booster_id);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_reassigned_by_admin', 'Você foi removido de um pedido',
    'Um administrador reatribuiu este pedido para outro booster. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin', 'Um pedido foi atribuído a você',
    'Um administrador atribuiu este pedido a você. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id, 'new_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

-- ── 8. admin_drop_order: exige sync recente antes de dropar ───────────────
-- Não é sobre atribuição de stats (a tabela de janelas já resolve isso) -- é
-- sobre pagamento proporcional (order_drop_completion_pct) não ficar
-- sub-contado por partidas jogadas mas ainda não sincronizadas na hora do
-- drop. Mesmo padrão que request_order_drop já tinha, admin_drop_order
-- nunca teve.
create or replace function public.admin_drop_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_result jsonb;
  v_request_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played, drop_count, last_match_synced_at
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;

  if v_order.drop_count >= 2 then
    v_result := public.cancel_order_after_drop_limit(p_order_id, v_order.status::text, auth.uid(), v_reason);

    insert into public.order_drop_requests(
      order_id, booster_id, reason, wins_at_request, losses_at_request,
      penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
      requested_by_role
    ) values (
      p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
      (v_result->>'completion_pct')::numeric, 0,
      'approved', auth.uid(), 'Limite de 2 drops atingido -- pedido cancelado pelo admin', now(),
      'admin'
    )
    returning id into v_request_id;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.admin_canceled_after_drop_limit', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

    return jsonb_build_object('success', true, 'canceled', true);
  end if;

  v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason);

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
    requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    (v_result->>'completion_pct')::numeric, (v_result->>'payout_amount')::numeric,
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(),
    'admin'
  )
  returning id into v_request_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_dropped_by_admin', 'Você foi removido de um pedido',
    'Um administrador retirou você do pedido. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

  return jsonb_build_object('success', true, 'canceled', false);
end;
$$;

-- ── 9. Recalcula desempenho de todo mundo com booster_id já corrigido ─────
select public.refresh_booster_performance_segments(null);
