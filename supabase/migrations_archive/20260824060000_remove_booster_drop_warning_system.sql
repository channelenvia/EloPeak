-- Remove o sistema automático de advertência/taxa/bloqueio por drop
-- (migration 128 + fixes subsequentes 129/132/135) -- decisão de produto:
-- o admin passa a validar manualmente pela tela de Drops (histórico já
-- mostra placar e % de conclusão de cada drop) e decide suspender/expulsar
-- caso a caso, em vez de um contador automático de advertências.
--
-- Mantém intacto o mecanismo de pagamento proporcional ao progresso
-- (order_drop_completion_pct, migration 116) -- é o que calcula quanto o
-- booster recebe e quanto o próximo booster/cliente tem de preço reduzido
-- quando um pedido é dropado no meio do caminho. Nada disso muda aqui.
--
-- Removido:
--   - order_drop_requests: penalty_bucket, penalty_fee_pct,
--     penalty_fee_amount, warning_issued, waived_by, waived_at.
--   - booster_profiles.blocked_until (bloqueio temporário automático).
--   - waive_drop_penalty() -- válvula de escape que só fazia sentido pro
--     sistema de taxa/advertência que está saindo.
--   - Classificação heavy_loss/light_loss/tied_or_winning, taxa de 5%/10% e
--     contagem de advertências ativas dentro de apply_order_drop().
--   - Exclusão de boosters bloqueados em available_boost_orders (não há
--     mais bloqueio automático pra excluir).
--
-- Mantido:
--   - order_drop_requests.penalty_pct/penalty_amount (preview e valor final
--     do pagamento proporcional -- nome legado, não é multa).
--   - Toda a lógica de completion_pct/payout dentro de apply_order_drop().
--   - drop_count/rank_before_last_drop/last_dropped_at (bookkeeping de
--     progresso, não de punição).
--   - booster_profiles.suspended_until/status='suspended' -- suspensão
--     manual do admin (migration 142), caminho totalmente separado.

-- ── apply_order_drop: remove classificação/taxa/advertência ────────────────
-- Base: migrations_archive/135_fix_wins_purchased_after_drop.sql (versão
-- vigente), só removendo o bloco de classificação/taxa/advertência e as
-- colunas do retorno que dependiam dele.
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
begin
  select id, service_type, total_price, current_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

  -- Trava a linha do booster antes de creditar o payout -- serializa contra
  -- request_payout() (mesma linha), evitando saldo negativo em corrida.
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
    'payout_amount', v_payout
  );
end;
$$;

-- ── resolve_drop_request: remove a gravação das colunas de advertência ─────
-- Base: supabase/migrations/153_drop_request_approval_limit.sql (versão
-- vigente) -- só o branch de aprovação muda, o resto é idêntico.
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

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    select drop_count into v_drop_count from public.orders where id = v_req.order_id;
    if coalesce(v_drop_count, 0) >= 2 then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
    end if;

    v_result := public.apply_order_drop(v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved');

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

  return jsonb_build_object('success', true);
end;
$$;

-- ── admin_drop_order: remove a gravação das colunas de advertência ─────────
-- Base: supabase/migrations/153_drop_request_approval_limit.sql (versão
-- vigente).
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

  select id, status, assigned_booster_id, wins_played, losses_played, drop_count
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
  if v_order.drop_count >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
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

  return jsonb_build_object('success', true);
end;
$$;

-- ── waive_drop_penalty: sem sentido sem taxa/advertência pra isentar ───────
drop function if exists public.waive_drop_penalty(uuid, text);

-- ── trg_fn_guard_booster_profile_trust_columns: para de proteger uma coluna
-- que está saindo ──────────────────────────────────────────────────────────
-- Base: migrations_archive/129_fix_drop_penalty_security_and_races.sql
-- (versão vigente), só removendo a linha do blocked_until.
create or replace function public.trg_fn_guard_booster_profile_trust_columns()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status          := old.status;
    new.total_completed := old.total_completed;
    new.total_earnings  := old.total_earnings;
    new.rating          := old.rating;
    new.rating_count    := old.rating_count;
    new.is_top3         := old.is_top3;
    new.verified_at     := old.verified_at;
    new.current_rank    := old.current_rank;
  end if;
  return new;
end;
$$;

-- ── trg_notify_booster_profile_changed: para de disparar por blocked_until ─
-- Base: supabase/migrations/155_realtime_events_boosters_duo_accounts.sql
-- (versão vigente).
drop trigger if exists trg_notify_booster_profile_changed on public.booster_profiles;
create trigger trg_notify_booster_profile_changed
after update of status, rating, rating_count, is_top3, current_rank, display_name, last_active_at, suspended_until
on public.booster_profiles
for each row execute function public.notify_booster_profile_changed();

-- ── available_boost_orders: remove a exclusão de boosters bloqueados ───────
-- Base: supabase/migrations/20260824040000_fix_coaching_exclusivity_regression.sql
-- (versão vigente -- mais recente que a 20260824010000, já restaura o branch
-- de exclusividade de coaching, preservado aqui).
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type,
  clash_tier, clash_day, customer_lanes
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    case
      when service_type = 'coaching' then preferred_booster_id = auth.uid()
      else preferred_booster_id is null
        or exclusive_until is null
        or exclusive_until <= now()
        or preferred_booster_id = auth.uid()
    end
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;

-- ── Colunas do sistema de advertência/taxa/bloqueio ─────────────────────────
alter table public.order_drop_requests
  drop column if exists penalty_bucket,
  drop column if exists penalty_fee_pct,
  drop column if exists penalty_fee_amount,
  drop column if exists warning_issued,
  drop column if exists waived_by,
  drop column if exists waived_at;

alter table public.booster_profiles
  drop column if exists blocked_until;
