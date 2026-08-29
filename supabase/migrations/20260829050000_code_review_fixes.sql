-- Correções do code-review em cima das migrations desta sessão (2026082902-4*):
--
--   1. record_order_match/record_duo_match passam a devolver booster_id no
--      retorno -- sync-order-matches precisa saber QUAL booster
--      efetivamente recebeu cada partida (pode não ser order.assigned_booster_id
--      depois de um reassign, ver booster_assigned_at) pra chamar
--      refresh_booster_performance_segments pro booster CERTO, não só pro
--      atual. Sem isso, o booster antigo que jogou a partida mas foi
--      reatribuído fica com o desempenho desatualizado até um refresh global.
--
--   2. admin_reassign_booster só checava se o booster alvo EXISTE, não se
--      está com status='approved' -- dava pra reatribuir pra um booster
--      suspenso/removido/pendente. Também não notificava o cliente (o drop
--      normal via apply_order_drop já faz isso).
--
--   3. win_value_cents não tinha "revoke all ... from public, anon,
--      authenticated" explícito (inconsistente com todo o resto desta
--      safra de migrations) -- hoje inofensivo porque a tabela por trás já
--      é revogada, mas é uma defesa a menos.
--
--   4. win_penalty_price_cents/win_value_cents ignoravam queue_type -- hoje
--      WIN_PRICE_CENTS (shared/pricing.ts) tem valores idênticos pra
--      solo_duo/flex, mas se isso divergir no futuro (mudança de preço
--      plausível), a fórmula da taxa de drop ficaria errada silenciosamente
--      pra pedidos de fila flex. Tabela recriada com a dimensão certa desde
--      já (mesmos valores duplicados pras duas filas -- sem mudança de
--      comportamento agora, só fecha a brecha).

-- ── 1. record_order_match/record_duo_match devolvem booster_id ────────────
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

  if v_order.boost_mode = 'duo' and not coalesce(p_duo_participated, false) then
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

  if v_inserted then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    else
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;

revoke all on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer, boolean) to service_role;

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

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;

revoke all on function public.record_duo_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.record_duo_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz, integer, integer, boolean, integer) to service_role;

-- ── 2. admin_reassign_booster: exige status='approved' + avisa o cliente ──
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

  select id, status, assigned_booster_id, last_match_synced_at, customer_id
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

  select user_id, display_name, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
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

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Booster do seu pedido foi trocado',
      'Um administrador reatribuiu seu pedido para outro booster.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id, 'new_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;

-- ── 3/4. win_penalty_price_cents ganha queue_type + win_value_cents revoke ─
drop table public.win_penalty_price_cents;

create table public.win_penalty_price_cents (
  queue_type  text not null check (queue_type in ('solo_duo', 'flex')),
  boost_mode  text not null check (boost_mode in ('solo', 'duo')),
  tier        text not null,
  price_cents integer not null,
  primary key (queue_type, boost_mode, tier)
);

insert into public.win_penalty_price_cents (queue_type, boost_mode, tier, price_cents)
select queue_type, boost_mode, tier, price_cents
from (values
  ('solo', 'iron', 458), ('solo', 'bronze', 458), ('solo', 'silver', 479), ('solo', 'gold', 567),
  ('solo', 'platinum', 930), ('solo', 'emerald', 1315), ('solo', 'diamond', 1685),
  ('solo', 'master', 5830), ('solo', 'grandmaster', 8620), ('solo', 'challenger', 14440),
  ('duo', 'iron', 605), ('duo', 'bronze', 605), ('duo', 'silver', 795), ('duo', 'gold', 929),
  ('duo', 'platinum', 1085), ('duo', 'emerald', 2005), ('duo', 'diamond', 2995), ('duo', 'master', 8515)
) as v(boost_mode, tier, price_cents)
cross join (values ('solo_duo'), ('flex')) as q(queue_type);

alter table public.win_penalty_price_cents enable row level security;
revoke all on public.win_penalty_price_cents from public, anon, authenticated;

drop function if exists public.win_value_cents(text, text);

create or replace function public.win_value_cents(p_queue_type text, p_boost_mode text, p_tier text)
returns integer
language sql stable as $$
  select coalesce(
    (select price_cents from public.win_penalty_price_cents where queue_type = p_queue_type and boost_mode = p_boost_mode and tier = p_tier),
    (select price_cents from public.win_penalty_price_cents where queue_type = p_queue_type and boost_mode = p_boost_mode and tier = 'master'),
    (select price_cents from public.win_penalty_price_cents where queue_type = 'solo_duo' and boost_mode = 'solo' and tier = 'diamond')
  )
$$;

revoke all on function public.win_value_cents(text, text, text) from public, anon, authenticated;

-- apply_order_drop/cancel_order_after_drop_limit: passam queue_type pro
-- helper agora que ele tem 3 parâmetros -- resto do corpo idêntico ao que
-- já estava em 20260829040000.
create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text,
  p_requested_by_role public.drop_requester_role default 'admin'
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
  v_fee_amount          numeric := 0;
  v_negative_matches    integer;
  v_win_cents           integer;
  v_penalty_pct         numeric := 0;
  v_warning_issued      boolean := false;
  v_light_loss_count    integer;
  v_prior_warnings      integer;
  v_new_warning_count   integer;
  v_new_blocked_until   timestamptz;
begin
  select id, service_type, total_price, current_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased, boost_mode, queue_type
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

  v_new_wins_purchased := case
    when v_order.service_type in ('win_boost', 'md5') and v_order.wins_purchased is not null
      then greatest(0, v_order.wins_purchased - coalesce(v_order.wins_played, 0))
    else v_order.wins_purchased
  end;

  v_games_played := coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0);

  if v_order.losses_played > v_order.wins_played and v_order.losses_played >= 3 then
    v_bucket := 'heavy_loss';
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

    v_warning_issued := v_light_loss_count >= 2;

  else
    v_bucket := 'tied_or_winning';
    v_warning_issued := v_games_played > 6;
  end if;

  v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));
  v_win_cents := case
    when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
      then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
    else 0
  end;
  v_penalty_pct := case when p_requested_by_role = 'booster' then 0.75 else 0.50 end;
  v_fee_amount  := round((v_win_cents / 100.0) * v_penalty_pct * v_negative_matches, 2);

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
      'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s), '
        || round(v_penalty_pct * 100) || '% do valor da vitória no tier atual) referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Este pedido estava negativado (' || v_negative_matches || ' derrota(s) a mais que vitórias) no drop. '
        || 'Uma taxa de R$ ' || v_fee_amount::text
        || ' (' || round(v_penalty_pct * 100) || '% do valor da vitória no tier atual, por partida negativada) '
        || 'foi descontada do seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_fee_amount, 'pct', v_penalty_pct, 'negative_matches', v_negative_matches)
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
    'penalty_fee_pct', v_penalty_pct,
    'penalty_fee_amount', v_fee_amount,
    'negative_matches', v_negative_matches,
    'warning_issued', v_warning_issued
  );
end;
$$;

create or replace function public.cancel_order_after_drop_limit(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text,
  p_requested_by_role public.drop_requester_role default 'admin'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_completion_pct numeric;
  v_negative_matches integer;
  v_win_cents        integer;
  v_penalty_pct      numeric := 0;
  v_fee_amount       numeric := 0;
begin
  select id, customer_id, assigned_booster_id, boost_mode, current_rank, service_type, queue_type, wins_played, losses_played
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
    v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));
    v_win_cents := case
      when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
        then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
      else 0
    end;
    v_penalty_pct := case when p_requested_by_role = 'booster' then 0.75 else 0.50 end;
    v_fee_amount  := round((v_win_cents / 100.0) * v_penalty_pct * v_negative_matches, 2);

    if v_fee_amount > 0 then
      insert into public.booster_ledger_entries(
        booster_id, order_id, entry_type, amount, description, actor_id, actor_role
      ) values (
        v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
        'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s), '
          || round(v_penalty_pct * 100) || '% do valor da vitória no tier atual) referente ao pedido '
          || p_order_id::text || ' (cancelado por limite de drops)',
        p_actor_id, 'admin'::public.user_role
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_dropped_by_admin', 'Pedido cancelado pelo admin',
      'Este pedido atingiu o limite de 2 drops e foi cancelado por um administrador. Motivo: ' || p_reason
        || case when v_fee_amount > 0
             then '. Uma taxa de R$ ' || v_fee_amount::text || ' foi descontada do seu saldo (pedido negativado).'
             else '. Nosso time vai falar com você individualmente sobre o pagamento.'
           end,
      jsonb_build_object('order_id', p_order_id, 'penalty_amount', v_fee_amount)
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

  return jsonb_build_object('completion_pct', v_completion_pct, 'penalty_amount', v_fee_amount);
end;
$$;
