-- Pedido do usuário: (1) o sistema de advertência/bloqueio temporário/
-- suspensão automática por drops negativados não existe mais -- remove de
-- vez de apply_order_drop; (2) request_customer_order_drop (cliente
-- solicitando drop do booster) passa a exigir sync de partidas antes, igual
-- já acontecia em request_order_drop (booster solicitando).
--
-- Achado bônus na conferência: o bloco de advertência que estava em
-- apply_order_drop (migrations 20260829040000/050000) referenciava
-- order_drop_requests.penalty_bucket, .waived_at e .warning_issued -- essas
-- colunas foram documentadas como INEXISTENTES na tabela ao vivo pela
-- migration 20260827110000 (que removeu um overload órfão desse mesmo
-- sistema de advertência abandonado). Ou seja: TODA aprovação de drop
-- (resolve_drop_request e admin_drop_order, que chamam apply_order_drop)
-- estava quebrando com "column does not exist" desde que 20260829040000 foi
-- aplicada -- essa migration não só remove o sistema descontinuado como
-- corrige esse bug ao vivo como efeito colateral.

-- ── 1. apply_order_drop sem o sistema de advertência/bloqueio/suspensão ────
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
  v_fee_amount          numeric := 0;
  v_negative_matches    integer;
  v_win_cents           integer;
  v_penalty_pct         numeric := 0;
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
    'penalty_fee_pct', v_penalty_pct,
    'penalty_fee_amount', v_fee_amount,
    'negative_matches', v_negative_matches
  );
end;
$$;

revoke all on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role) from public, anon, authenticated;

-- ── 2. request_customer_order_drop exige sync antes, igual request_order_drop
--      -- só quando o pedido já está in_progress (mesmo padrão condicional
--      usado em admin_reassign_booster/admin_drop_order): se ainda está só
--      'assigned' (booster nem começou) não tem o que sincronizar, e bloquear
--      o cliente nesse caso não faria sentido.
create or replace function public.request_customer_order_drop(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_existing       uuid;
  v_completion_pct numeric;
  v_is_top3        boolean;
  v_share_pct      numeric;
  v_preview_payout numeric;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id, wins_played, losses_played, total_price, drop_count, last_match_synced_at
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
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
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'customer', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop', 'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$$;
