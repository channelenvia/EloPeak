-- Troca a cobrança de drop (booster larga um pedido "negativado" -- mais
-- derrotas do que vitórias) de "% fixo do total_price por bucket
-- heavy_loss/light_loss" pra "50%/75% do valor de UMA vitória no tier atual
-- do pedido, por partida negativada (derrotas em excesso sobre vitórias)".
-- 50% quando quem pediu o drop foi o cliente ou o admin; 75% quando foi o
-- próprio booster -- faz sentido no drop voltar a ser sempre uma decisão
-- manual do admin (resolve_drop_request/admin_drop_order), o booster tem
-- menos desculpa pra largar um pedido no vermelho.
--
-- O sistema de aviso/bloqueio temporário/suspensão em 5 avisos
-- (v_bucket/v_warning_issued) continua EXATAMENTE como estava -- só a
-- cobrança monetária muda de fórmula, os dois viram conceitos independentes
-- a partir de agora.
--
-- "Valor de uma vitória" não existe hoje pra Elo Boost (só tem preço por
-- divisão) -- usamos a MESMA tabela de preço-por-vitória do Win Boost
-- (WIN_PRICE_CENTS em shared/pricing.ts), por tier + boost_mode, pros dois
-- tipos de serviço (elo_boost e win_boost/md5). Cópia fiel dos valores TS --
-- se WIN_PRICE_CENTS mudar lá, precisa de uma migration nova aqui também.
-- Serviços sem tier rastreado (clash, coaching, placement_matches) não
-- entram nessa cobrança -- v_win_cents fica 0 pra eles.

create table public.win_penalty_price_cents (
  boost_mode  text not null check (boost_mode in ('solo', 'duo')),
  tier        text not null,
  price_cents integer not null,
  primary key (boost_mode, tier)
);

insert into public.win_penalty_price_cents (boost_mode, tier, price_cents) values
  ('solo', 'iron', 458), ('solo', 'bronze', 458), ('solo', 'silver', 479), ('solo', 'gold', 567),
  ('solo', 'platinum', 930), ('solo', 'emerald', 1315), ('solo', 'diamond', 1685),
  ('solo', 'master', 5830), ('solo', 'grandmaster', 8620), ('solo', 'challenger', 14440),
  ('duo', 'iron', 605), ('duo', 'bronze', 605), ('duo', 'silver', 795), ('duo', 'gold', 929),
  ('duo', 'platinum', 1085), ('duo', 'emerald', 2005), ('duo', 'diamond', 2995), ('duo', 'master', 8515);

alter table public.win_penalty_price_cents enable row level security;
revoke all on public.win_penalty_price_cents from public, anon, authenticated;

-- Mesma cadeia de fallback de getWinBoostPrice (shared/pricing.ts): tier
-- exato -> preço de 'master' do mesmo modo -> solo/diamond como último
-- recurso. Nunca deveria cair no último degrau em uso real (Duo Boost é
-- bloqueado a partir de Grão-Mestre), é só defesa contra chamada com tier
-- fora do esperado.
create or replace function public.win_value_cents(p_boost_mode text, p_tier text)
returns integer
language sql stable as $$
  select coalesce(
    (select price_cents from public.win_penalty_price_cents where boost_mode = p_boost_mode and tier = p_tier),
    (select price_cents from public.win_penalty_price_cents where boost_mode = p_boost_mode and tier = 'master'),
    (select price_cents from public.win_penalty_price_cents where boost_mode = 'solo' and tier = 'diamond')
  )
$$;

-- ── apply_order_drop: nova fórmula de cobrança ─────────────────────────────
drop function if exists public.apply_order_drop(uuid, text, uuid, text);

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
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased, boost_mode
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

  -- v_bucket/v_warning_issued: só alimentam o sistema de aviso/bloqueio/
  -- suspensão abaixo -- desde que a cobrança monetária virou uma fórmula
  -- própria (ver bloco seguinte), esses dois conceitos são independentes.
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

  -- Cobrança: 50% (cliente/admin) ou 75% (booster) do valor de uma vitória
  -- no tier atual, por partida negativada (derrotas em excesso sobre
  -- vitórias). Só elo_boost/win_boost/md5 têm um "valor de vitória"
  -- significativo -- outros serviços ficam com v_win_cents = 0.
  v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));
  v_win_cents := case
    when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
      then public.win_value_cents(v_order.boost_mode, v_order.current_rank->>'tier')
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

revoke all on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role) from public, anon, authenticated;

-- ── cancel_order_after_drop_limit: ganha a mesma cobrança ──────────────────
drop function if exists public.cancel_order_after_drop_limit(uuid, text, uuid, text);

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
  select id, customer_id, assigned_booster_id, boost_mode, current_rank, service_type, wins_played, losses_played
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
        then public.win_value_cents(v_order.boost_mode, v_order.current_rank->>'tier')
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

revoke all on function public.cancel_order_after_drop_limit(uuid, text, uuid, text, public.drop_requester_role) from public, anon, authenticated;

-- ── resolve_drop_request: repassa quem pediu o drop original ──────────────
create or replace function public.resolve_drop_request(p_request_id uuid, p_approve boolean, p_admin_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
  v_drop_count integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    select drop_count into v_drop_count from public.orders where id = v_req.order_id;

    if coalesce(v_drop_count, 0) >= 2 then
      v_result := public.cancel_order_after_drop_limit(
        v_req.order_id, 'drop_requested', auth.uid(),
        coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado pelo admin'),
        v_req.requested_by_role
      );

      insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
      values (v_actor.id, v_actor.role, 'drop_request.approved_as_cancel', 'order_drop_request', p_request_id::text,
              jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

      update public.order_drop_requests
      set    status         = 'approved',
             admin_id       = auth.uid(),
             admin_note     = coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado'),
             penalty_pct    = (v_result->>'completion_pct')::numeric,
             penalty_amount = coalesce((v_result->>'penalty_amount')::numeric, 0),
             resolved_at    = now()
      where  id = p_request_id;

      return jsonb_build_object('success', true, 'canceled', true);
    end if;

    v_result := public.apply_order_drop(v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role);

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_pct    = (v_result->>'completion_pct')::numeric,
           penalty_amount = (v_result->>'payout_amount')::numeric,
           resolved_at = now()
    where  id = p_request_id;
  else
    v_restore_status := coalesce(v_req.status_at_request, 'in_progress');

    update public.orders set status = v_restore_status, updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', v_restore_status, auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));

    update public.order_drop_requests
    set    status      = 'rejected',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           resolved_at = now()
    where  id = p_request_id;
  end if;

  return jsonb_build_object('success', true, 'canceled', false);
end;
$$;

-- ── admin_drop_order: drop direto do admin, sem pedido prévio ──────────────
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
    v_result := public.cancel_order_after_drop_limit(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin');

    insert into public.order_drop_requests(
      order_id, booster_id, reason, wins_at_request, losses_at_request,
      penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
      requested_by_role
    ) values (
      p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
      (v_result->>'completion_pct')::numeric, coalesce((v_result->>'penalty_amount')::numeric, 0),
      'approved', auth.uid(), 'Limite de 2 drops atingido -- pedido cancelado pelo admin', now(),
      'admin'
    )
    returning id into v_request_id;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.admin_canceled_after_drop_limit', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

    return jsonb_build_object('success', true, 'canceled', true);
  end if;

  v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin');

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
