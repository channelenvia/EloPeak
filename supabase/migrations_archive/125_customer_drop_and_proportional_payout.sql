-- Duas mudanças, no mesmo espírito da migration 116 (que substituiu a
-- penalidade fixa de 0/10/20% por um pagamento baseado em progresso real):
--
--   1) Cliente agora também pode solicitar drop (antes só booster/admin
--      podiam). Reaproveita a mesma tabela order_drop_requests e o mesmo
--      resolve_drop_request -- só adiciona de onde a solicitação partiu
--      (requested_by_role) e, pra permitir rejeitar corretamente uma
--      solicitação de cliente que pode ter partido de um status diferente
--      de 'in_progress' (paused/awaiting_customer/assigned), guarda o
--      status original (status_at_request) pra restaurar exatamente ele
--      no reject em vez de sempre forçar 'in_progress'.
--
--   2) O corte de 50% em apply_order_drop() vira uma curva contínua:
--      pagamento e preço restante são proporcionais ao completion_pct real
--      (0% e 100% continuam nos mesmos extremos de hoje; o que muda é tudo
--      entre eles, que hoje pulava de 0 direto pra 50%). Nenhum cliente é
--      reembolsado -- o que o cliente já pagou fica com a empresa; só a
--      base de comissão do PRÓXIMO booster é que reflete o restante.
--
--      Também corrige um problema que a curva contínua deixaria mais visível:
--      match_sync_started_at só é setado uma vez (coalesce na transição
--      assigned->in_progress, migration 052) e nunca era resetado num drop --
--      então o próximo booster herdava o prazo calculado a partir do horário
--      de início do booster ANTERIOR. Agora reseta (junto com
--      last_match_synced_at) e estimated_hours é reduzido na mesma proporção
--      do preço, pro prazo do próximo booster refletir só o trabalho restante.
--
--      Pra dar visibilidade de que um pedido já foi dropado (painel de jobs,
--      detalhe do admin, detalhe do cliente), adiciona drop_count,
--      rank_before_last_drop (snapshot do current_rank antes de ser
--      sobrescrito pelo último rank verificado -- só assim dá pra mostrar
--      "avançou de X pra Y" no drop; current_rank->target_rank já funcionava)
--      e last_dropped_at.

-- ── Novas colunas em orders ──────────────────────────────────────────────
alter table public.orders
  add column drop_count integer not null default 0,
  add column rank_before_last_drop jsonb,
  add column last_dropped_at timestamptz;

comment on column public.orders.drop_count is
  'Quantas vezes este pedido já foi dropado (booster/admin/cliente). > 0 é o '
  'sinal de "pedido já foi dropado antes" usado nos disclaimers de UI.';
comment on column public.orders.rank_before_last_drop is
  'Snapshot de current_rank tirado logo antes do último drop sobrescrevê-lo '
  'com o rank verificado mais recente. Só populado pra elo_boost. Permite '
  'mostrar o progresso que o booster anterior entregou (rank_before_last_drop '
  '-> current_rank), além do current_rank -> target_rank que já existia.';
comment on column public.orders.last_dropped_at is
  'Timestamp do último drop aplicado a este pedido (null se nunca dropado).';

-- public.orders usa allow-list explícito de colunas pro grant select de
-- `authenticated` (migration 036/112) -- sem isso a coluna existe no banco
-- mas nenhum client consegue lê-la via PostgREST.
grant select (drop_count, rank_before_last_drop, last_dropped_at)
  on public.orders to authenticated;

-- ── requested_by_role + status_at_request em order_drop_requests ────────
create type public.drop_requester_role as enum ('booster', 'admin', 'customer');

alter table public.order_drop_requests
  add column requested_by_role public.drop_requester_role not null default 'booster',
  add column status_at_request public.order_status;

-- Backfill: todo drop direto de admin sempre inseriu esta admin_note fixa
-- (ver admin_drop_order abaixo, inalterado nesse texto desde a migration 071).
update public.order_drop_requests
set requested_by_role = 'admin'
where admin_note = 'Drop iniciado pelo admin';

-- Backfill: toda solicitação de booster histórica só podia partir de
-- 'in_progress' (única condição aceita por request_order_drop até aqui).
update public.order_drop_requests
set status_at_request = 'in_progress'
where requested_by_role = 'booster';

comment on column public.order_drop_requests.requested_by_role is
  'Quem originou o drop: booster (auto-solicitado), admin (drop direto) ou '
  'customer (cliente solicitou, precisa de aprovação igual ao de booster).';
comment on column public.order_drop_requests.status_at_request is
  'Status do pedido no momento em que a solicitação foi criada -- usado por '
  'resolve_drop_request para restaurar o status correto se a solicitação for '
  'rejeitada (antes sempre voltava pra in_progress, o que só era correto '
  'pra solicitações de booster, já que essas só partiam desse status).';

-- ── order_drop_completion_pct: sem mudança de lógica, só reaproveitada ──
-- (definida na migration 116, permanece igual)

-- ── apply_order_drop: curva contínua em vez do corte de 50% ─────────────
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
  v_price_changed       boolean;
begin
  select id, service_type, total_price, current_rank, customer_id,
         assigned_booster_id, estimated_hours
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

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
    match_sync_started_at  = null,
    last_match_synced_at   = null,
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

  return jsonb_build_object('completion_pct', v_completion_pct, 'payout_amount', v_payout);
end;
$$;

-- ── admin_drop_order: só passa a marcar requested_by_role='admin' ───────
create or replace function public.admin_drop_order(
  p_order_id uuid,
  p_reason   text
) returns jsonb
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

  select id, status, assigned_booster_id, wins_played, losses_played
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

-- ── request_order_drop: só passa a marcar requested_by_role/status_at_request ─
create or replace function public.request_order_drop(
  p_order_id uuid,
  p_reason   text
) returns jsonb
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
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played, total_price
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'in_progress' then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3 from public.booster_profiles where user_id = auth.uid();
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, auth.uid(), v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'booster', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), v_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$$;

-- ── request_customer_order_drop: nova RPC, mesmo formato de preview/pendência ─
create or replace function public.request_customer_order_drop(
  p_order_id uuid,
  p_reason   text
) returns jsonb
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
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id, wins_played, losses_played, total_price
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

revoke all on function public.request_customer_order_drop(uuid, text) from public, anon;
grant execute on function public.request_customer_order_drop(uuid, text) to authenticated;

-- ── resolve_drop_request: reject restaura status_at_request, não sempre 'in_progress' ─
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
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

-- ── available_boost_orders: adiciona as colunas do disclaimer de drop ───
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
