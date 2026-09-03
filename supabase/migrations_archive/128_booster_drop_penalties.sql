-- Política de DROP e penalidades (spec: docs/superpowers/specs/2026-08-01-booster-drop-penalties-design.md).
--
-- Até aqui um DROP era puramente "pagamento proporcional ao progresso"
-- (migration 125/116) -- sem consequência pro booster que desiste
-- repetidamente enquanto está perdendo. Esta migration adiciona isso em
-- cima do mecanismo que já existe, sem mudar o pagamento proporcional:
--
--   1) Classifica todo drop pelo placar AO VIVO do pedido no momento em que
--      o drop é executado (orders.wins_played/losses_played -- não o
--      snapshot capturado quando a solicitação foi aberta, porque pode
--      haver defasagem entre pedir e o admin aprovar):
--        - derrota pesada (derrotas > vitórias e derrotas >= 3): sempre 10%
--          de taxa + 1 advertência, sem escalonar.
--        - derrota leve (derrotas > vitórias e derrotas <= 2): escalona por
--          ocorrência nos últimos 30 dias -- 1ª grátis, 2ª só taxa de 5%,
--          3ª+ taxa de 5% + advertência.
--        - empatado ou ganhando (vitórias >= derrotas): grátis até 6 jogos
--          disputados; a partir do 7º, 1 advertência sem taxa.
--      Vale igual não importa quem iniciou o drop (booster, cliente ou
--      admin) -- todos passam por apply_order_drop().
--
--   2) Advertências: contador único (soma qualquer regra acima que gera "1
--      advertência"), cada uma expira 30 dias após ser gerada -- a contagem
--      é sempre "advertências ativas nos últimos 30 dias", derivada de
--      order_drop_requests (sem coluna de contador separada). Ao bater 2,
--      bloqueia 6h pra pegar pedido novo; ao bater 3, bloqueia 16h (só
--      estende se for depois do bloqueio atual); ao bater 5, suspende a
--      conta automaticamente (reaproveita booster_profiles.status).
--
--   3) Taxa é debitada na hora do drop (reativa o entry_type 'drop_penalty',
--      existente e sem uso desde a migration 095) -- reduz o saldo
--      disponível imediatamente, o que já cobre "descontado no saque" na
--      prática (o booster só vai sentir quando for sacar, porque vai ter
--      menos saldo disponível pra pedir).
--
--   4) waive_drop_penalty(): válvula de escape manual do admin pra reverter
--      a taxa e excluir aquele registro das contagens de ocorrência/
--      advertência ativa, pra casos excepcionais (bug do jogo, servidor
--      caiu etc).

-- ── Novas colunas ─────────────────────────────────────────────────────────
alter table public.order_drop_requests
  add column penalty_bucket text check (penalty_bucket in ('heavy_loss', 'light_loss', 'tied_or_winning')),
  add column penalty_fee_pct numeric,
  add column penalty_fee_amount numeric(10,2),
  add column warning_issued boolean not null default false,
  add column waived_by uuid references public.profiles(id),
  add column waived_at timestamptz;

comment on column public.order_drop_requests.penalty_bucket is
  'Classificação do drop pelo placar do pedido no momento da execução: '
  'heavy_loss (derrotas>vitórias e >=3), light_loss (derrotas>vitórias e '
  '<=2, escalona por ocorrência), tied_or_winning (vitórias>=derrotas).';
comment on column public.order_drop_requests.penalty_fee_pct is
  'Percentual da taxa de drop aplicada (0, 0.05 ou 0.10) -- distinto de '
  'penalty_pct, que é o completion_pct do pagamento proporcional.';
comment on column public.order_drop_requests.penalty_fee_amount is
  'Valor em R$ da taxa de drop debitada do booster -- distinto de '
  'penalty_amount, que é o payout proporcional creditado.';
comment on column public.order_drop_requests.warning_issued is
  'Se este drop gerou 1 advertência no contador do booster.';
comment on column public.order_drop_requests.waived_by is
  'Admin que isentou manualmente a taxa/advertência deste registro (null = não isentado).';
comment on column public.order_drop_requests.waived_at is
  'Quando a isenção manual foi aplicada -- registros com waived_at preenchido '
  'são excluídos das contagens de ocorrência/advertência ativa e do saldo '
  '(a taxa é estornada).';

alter table public.booster_profiles
  add column blocked_until timestamptz;

comment on column public.booster_profiles.blocked_until is
  'Até quando o booster está impedido de pegar pedidos novos (bloqueio '
  'temporário por advertências de drop). Não afeta pedidos já em andamento. '
  'Null = sem bloqueio ativo.';

-- ── apply_order_drop: adiciona o cálculo/aplicação da taxa e advertência ──
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
         assigned_booster_id, estimated_hours, wins_played, losses_played
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

  -- ── Classificação do drop e taxa/advertência ────────────────────────────
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

-- ── admin_drop_order: grava as novas colunas a partir do retorno de apply_order_drop ─
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
    requested_by_role, penalty_bucket, penalty_fee_pct, penalty_fee_amount, warning_issued
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    (v_result->>'completion_pct')::numeric, (v_result->>'payout_amount')::numeric,
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(),
    'admin', v_result->>'penalty_bucket', (v_result->>'penalty_fee_pct')::numeric,
    (v_result->>'penalty_fee_amount')::numeric, (v_result->>'warning_issued')::boolean
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

-- ── resolve_drop_request: grava as novas colunas no approve ─────────────
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
           penalty_bucket = v_result->>'penalty_bucket',
           penalty_fee_pct = (v_result->>'penalty_fee_pct')::numeric,
           penalty_fee_amount = (v_result->>'penalty_fee_amount')::numeric,
           warning_issued = (v_result->>'warning_issued')::boolean,
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

-- ── waive_drop_penalty: válvula de escape manual do admin ───────────────
create or replace function public.waive_drop_penalty(
  p_request_id uuid,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, booster_id, order_id, status, waived_at, penalty_fee_amount
  into v_req from public.order_drop_requests where id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'approved' then return jsonb_build_object('success', false, 'error', 'not_approved'); end if;
  if v_req.waived_at is not null then return jsonb_build_object('success', false, 'error', 'already_waived'); end if;

  if coalesce(v_req.penalty_fee_amount, 0) > 0 then
    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_req.booster_id, v_req.order_id, 'drop_penalty', v_req.penalty_fee_amount,
      'Estorno de taxa de drop (isenção manual)' || coalesce(': ' || p_admin_note, ''),
      auth.uid(), 'admin'::public.user_role
    );
  end if;

  update public.order_drop_requests
  set waived_by = auth.uid(), waived_at = now(),
      admin_note = coalesce(p_admin_note, admin_note)
  where id = p_request_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_req.booster_id, 'drop_penalty_waived', 'Taxa/advertência de drop isentada',
    'Um admin isentou manualmente a taxa e/ou advertência de um drop.' || coalesce(' Motivo: ' || p_admin_note, ''),
    jsonb_build_object('order_id', v_req.order_id, 'request_id', p_request_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'drop_request.penalty_waived', 'order_drop_request', p_request_id::text,
          jsonb_build_object('order_id', v_req.order_id, 'admin_note', p_admin_note));

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.waive_drop_penalty(uuid, text) from public, anon, authenticated;
grant execute on function public.waive_drop_penalty(uuid, text) to authenticated;

-- ── available_boost_orders: exclui boosters temporariamente bloqueados ──
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
  )
  and not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = auth.uid() and bp.blocked_until is not null and bp.blocked_until > now()
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
