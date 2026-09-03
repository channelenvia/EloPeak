-- Redesenho do sistema de drop (substitui as penalidades de 0/10/20% sobre
-- vitórias por um pagamento parcial baseado em progresso real do pedido):
--
--   < 50% concluído  -> booster não recebe nada pelo pedido dropado.
--   >= 50% concluído -> booster recebe 50% do que receberia normalmente
--                        (50% × 55% ou 50% × 60% se Top3, sobre o
--                        total_price ORIGINAL).
--
-- O pedido volta pro painel de jobs disponíveis (já reabre como
-- 'awaiting_assignment' desde as migrations 071/101 -- isso não muda), mas
-- agora carrega adiante o progresso real:
--   - Elo Boost: current_rank atualizado pro último rank verificado
--     (order_rank_verifications), em vez de continuar mostrando o rank
--     inicial do pedido -- o próximo booster continua de onde o anterior
--     parou, não do zero.
--   - Vitórias/MD5: wins_played/losses_played já não eram resetados, segue
--     igual.
--   - total_price do pedido reaberto: metade do valor original se o drop
--     aconteceu com >=50% concluído (menos trabalho restante, preço
--     proporcional pro próximo booster); valor cheio se <50% (quase nada
--     foi feito, preço integral continua valendo). Esse total_price é o
--     mesmo campo usado tanto pra exibir o valor no painel de jobs quanto
--     pra base de comissão do próximo booster -- e também é o que o
--     cliente vê como "valor pago" no detalhe do pedido, então um drop
--     com pagamento parcial muda esse número visível pro cliente também
--     (intencional: reflete que metade do serviço contratado já foi
--     entregue por outro booster).
--
-- Clash e Coaching não têm uma métrica de progresso gradual (não há
-- "rank atual" nem "vitórias" acumulando) -- tratados sempre como <50%
-- (nenhum pagamento parcial, preço integral ao reabrir). Master+ (PDL) usa
-- uma aproximação binária: só conta como >=50% se já existir uma
-- verificação com passed=true (alcançou o corte) -- fora isso, 0%, já que
-- comparar progresso de PDL exigiria o corte ao vivo da Riot, que esta
-- função (chamada de dentro de uma transação de banco) não pode consultar.

-- rank_step(p_tier, p_division) já existe (usada por complete_verified_order)
-- -- reaproveitada abaixo, não recriada.

-- ── Helper: % concluído do pedido no momento do drop ────────────────────────
create or replace function public.order_drop_completion_pct(p_order_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_order  record;
  v_latest record;
  v_from_step integer;
  v_to_step   integer;
  v_cur_step  integer;
begin
  select service_type, wins_played, wins_purchased, current_rank, target_rank, pdl_bracket
  into v_order from public.orders where id = p_order_id;

  if not found then return 0; end if;

  if v_order.service_type in ('win_boost', 'md5') then
    if coalesce(v_order.wins_purchased, 0) <= 0 then return 0; end if;
    return least(100, greatest(0,
      (coalesce(v_order.wins_played, 0)::numeric / v_order.wins_purchased::numeric) * 100
    ));
  end if;

  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null and v_order.target_rank is not null then
    select fetched_tier, fetched_division, passed into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;

    -- Master+ (PDL): sem corte ao vivo disponível aqui -- só considera
    -- concluído (100%) se a última verificação já bateu o alvo.
    if v_order.pdl_bracket is not null then
      if v_latest.passed is true then return 100; end if;
      return 0;
    end if;

    if v_latest.fetched_tier is null then return 0; end if;

    v_from_step := public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division');
    v_to_step   := public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division');
    v_cur_step  := public.rank_step(v_latest.fetched_tier, v_latest.fetched_division);

    if v_to_step <= v_from_step then return 0; end if;
    return least(100, greatest(0,
      ((v_cur_step - v_from_step)::numeric / (v_to_step - v_from_step)::numeric) * 100
    ));
  end if;

  -- Clash, Coaching, placement_matches: sem progresso gradual.
  return 0;
end;
$$;

revoke all on function public.order_drop_completion_pct(uuid) from public;

-- ── Aplica o resultado do drop: reabre o pedido, carrega o progresso ───────
-- adiante, ajusta o preço e credita o pagamento parcial (se aplicável).
-- Chamada de dentro de admin_drop_order e resolve_drop_request (approve) --
-- as duas já fazem suas próprias validações/locks antes de chegar aqui.
create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order            record;
  v_completion_pct   numeric;
  v_is_top3          boolean;
  v_share_pct        numeric;
  v_payout           numeric;
  v_latest           record;
  v_new_current_rank jsonb;
  v_new_total_price  numeric;
begin
  select id, service_type, total_price, current_rank, customer_id, assigned_booster_id
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  if v_completion_pct >= 50 then
    v_payout          := round(v_order.total_price * v_share_pct * 0.5, 2);
    v_new_total_price := round(v_order.total_price * 0.5, 2);
  else
    v_payout          := 0;
    v_new_total_price := v_order.total_price;
  end if;

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
    status               = 'awaiting_assignment',
    assigned_booster_id  = null,
    preferred_booster_id = null,
    exclusive_until      = null,
    used_exclusive_slot  = false,
    total_price          = v_new_total_price,
    current_rank         = v_new_current_rank,
    updated_at           = now()
  where id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status, 'awaiting_assignment', p_actor_id, p_reason);

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

revoke all on function public.apply_order_drop(uuid, text, uuid, text) from public;

-- ── admin_drop_order: agora paga em vez de nunca aplicar nada ──────────────
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

  v_result := public.apply_order_drop(p_order_id, v_order.status, auth.uid(), v_reason);

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    (v_result->>'completion_pct')::numeric, (v_result->>'payout_amount')::numeric,
    'approved', auth.uid(), 'Drop iniciado pelo admin', now()
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

-- ── request_order_drop: guarda uma prévia do pagamento (não aplica ainda,
-- ── só na aprovação) ─────────────────────────────────────────────────────
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
  v_preview_payout := case
    when v_completion_pct >= 50 then round(v_order.total_price * v_share_pct * 0.5, 2)
    else 0
  end;

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount)
  values (p_order_id, auth.uid(), v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), v_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$$;

-- ── resolve_drop_request: aplica o resultado real na aprovação (recalcula
-- ── na hora, não reaproveita a prévia -- é o que já era feito ali dentro) ──
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
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status
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
    update public.orders set status = 'in_progress', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'in_progress', auth.uid(), 'Drop request rejected');
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

comment on column public.order_drop_requests.penalty_pct is
  'Renomeação em espírito, não em nome: % de conclusão do pedido no momento '
  'do drop (>=50 paga, <50 não paga) -- não é mais um percentual de multa. '
  'Nome da coluna preservado pra não quebrar leitores existentes.';
comment on column public.order_drop_requests.penalty_amount is
  'Valor PAGO ao booster (crédito, não desconto) por progresso parcial no '
  'pedido dropado -- 0 se completion_pct < 50%. Nome preservado por '
  'compatibilidade; ver comentário de penalty_pct.';
