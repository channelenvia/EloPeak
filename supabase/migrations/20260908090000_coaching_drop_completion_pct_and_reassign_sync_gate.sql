-- Duas coisas de coaching relacionadas a drop/reatribuição de pedido ativo:
--
-- 1. admin_reassign_booster tinha a MESMA guarda que já corrigimos em
--    request_order_drop (migration 20260908080000): bloqueava reatribuição
--    de um pedido 'in_progress' sem last_match_synced_at. Coaching nunca
--    sincroniza partida (sem riot_id, ver orderPricing.ts) -- nenhum coach
--    conseguia ser trocado num pedido de coaching ativo, nem pelo admin.
--
-- 2. order_drop_completion_pct sempre retorna 0 pra coaching ("sem
--    progresso gradual", migrations_archive/116) -- correto pra Clash (evento
--    único de fim de semana), mas não pra coaching: um coach que já deu a
--    maioria das sessões de um pacote e é trocado/dropado ficava sem receber
--    nada pelo trabalho feito. Não existe hoje um jeito automático de medir
--    "quantas sessões de coaching já foram entregues" (sessions_purchased
--    nunca chega a ser preenchido no fluxo de compra atual -- é só exibição
--    condicional, nunca setado por CoachPackagePicker), então em vez de
--    inventar uma métrica automática, adiciona um p_coaching_completion_pct
--    OPCIONAL nos 3 pontos de entrada de drop/reatribuição -- o admin, que já
--    aprova/inicia essas ações manualmente e normalmente já conversou com
--    cliente/coach sobre quantas sessões rolaram, informa o % entregue na
--    hora. Sem valor informado, comportamento default continua exatamente
--    como antes (0%, calculado por order_drop_completion_pct) -- não muda
--    nada pra quem não passa o parâmetro novo.
--
-- CREATE OR REPLACE só substitui uma função de mesma assinatura (nome +
-- tipos de parâmetro) -- como as 4 funções abaixo ganham um parâmetro novo,
-- sem os drops explícitos a assinatura antiga (sem o parâmetro) ficaria
-- coexistindo como uma sobrecarga separada, e o PostgREST (supabase.rpc)
-- ficaria ambíguo sobre qual versão chamar quando o cliente não manda o
-- parâmetro novo.
drop function if exists public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role);
drop function if exists public.admin_drop_order(uuid, text);
drop function if exists public.resolve_drop_request(uuid, boolean, text);
drop function if exists public.admin_reassign_booster(uuid, uuid, text);

create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text,
  p_requester_role drop_requester_role,
  p_coaching_completion_pct numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order                 record;
  v_is_top3                boolean;
  v_share_pct              numeric;
  v_is_positive            boolean;
  v_over_limit             boolean;
  v_payout                 numeric := 0;
  v_penalty                numeric := 0;
  v_new_total_price        numeric;
  v_new_wins_purchased     integer;
  v_new_estimated_hours    numeric;
  v_new_current_rank       jsonb;
  v_latest_rank            record;
  v_win_value_unit         numeric;
  v_divisions_remaining    numeric;
  v_division_value_full    numeric;
  v_division_value_share   numeric;
  v_steps_crossed          integer;
  v_win_value_master_cents integer;
  v_win_value_master_full  numeric;
  v_win_value_master_share numeric;
  v_cutoff_pdl             integer;
  v_original_pdl           integer;
  v_latest_pdl             integer;
  v_new_current_pdl        integer;
  v_pdl_remaining          numeric;
  v_quarter_pdl            numeric;
  v_booster_share          numeric;
  v_quarter_value          numeric;
  v_quarters_completed     integer;
  v_completion_pct         numeric;
  v_completion_frac        numeric;
begin
  select id, service_type, boost_mode, queue_type, total_price, current_rank, target_rank,
         current_pdl, customer_id, assigned_booster_id, estimated_hours, wins_played,
         losses_played, wins_purchased, drop_count, status
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned');
  end if;

  if v_order.status::text <> p_from_status then
    return jsonb_build_object('success', false, 'error', 'order_status_mismatch');
  end if;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id for update;
  -- Coaching tem taxa própria e fixa (70%, ver trg_fn_order_completed_booster_stats
  -- e boosterEarningsShare em src/lib/utils.ts) -- não varia com is_top3.
  v_share_pct := case
    when v_order.service_type = 'coaching' then 0.70
    when v_is_top3 then 0.60
    else 0.55
  end;

  v_is_positive := coalesce(v_order.wins_played, 0) >= coalesce(v_order.losses_played, 0);
  v_over_limit  := v_order.drop_count >= 2;
  v_new_current_pdl := v_order.current_pdl;

  -- ── Limite de 2 drops: cancela em vez de reabrir, tudo manual daqui ────
  if v_over_limit then
    update public.orders set
      status                = 'under_review',
      assigned_booster_id   = null,
      preferred_booster_id  = null,
      exclusive_until       = null,
      used_exclusive_slot   = false,
      drop_count            = drop_count + 1,
      last_dropped_at       = now(),
      updated_at            = now()
    where id = p_order_id;

    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = p_order_id;

    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, p_from_status::public.order_status, 'under_review', p_actor_id,
      'Limite de 2 drops atingido -- pedido cancelado; reembolso do cliente e saldo do booster pendentes de resolução manual. ' || p_reason
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido atingiu o limite de drops e está sendo analisado manualmente pela nossa equipe. Entraremos em contato pelo chat do pedido.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido que você tinha foi cancelado após atingir o limite de drops e está em análise manual da equipe.',
      jsonb_build_object('order_id', p_order_id)
    );

    return jsonb_build_object('success', true, 'under_review', true, 'drop_count', v_order.drop_count + 1);
  end if;

  -- ── Win Boost / MD5 ──────────────────────────────────────────────────
  if v_order.service_type in ('win_boost', 'md5') then
    v_win_value_unit := case
      when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
      else 0
    end;

    v_new_wins_purchased := greatest(0,
      coalesce(v_order.wins_purchased, 0) - coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0));

    v_new_total_price := round(v_win_value_unit * v_new_wins_purchased, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null and coalesce(v_order.wins_purchased, 0) > 0
        then round(v_order.estimated_hours / v_order.wins_purchased * v_new_wins_purchased, 2)
      else v_order.estimated_hours
    end;
    v_new_current_rank := v_order.current_rank;

    if v_is_positive then
      v_payout := round(v_win_value_unit * v_share_pct * coalesce(v_order.wins_played, 0), 2);
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_unit, round(v_win_value_unit * v_share_pct, 2), v_order.losses_played);
    end if;

  -- ── Elo/Duo Boost: current_rank/target_rank nulos são um estado de dados
  -- inválido pra esse service_type (nunca deveriam estar assim num pedido
  -- ativo) -- sem essa guarda, rank_step(null, ...) propaga NULL até
  -- total_price silenciosamente. Falha alto e claro em vez disso.
  elsif v_order.service_type = 'elo_boost' and (v_order.current_rank is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ (current tier já em master/gm/challenger) ─
  elsif v_order.service_type = 'elo_boost'
    and (v_order.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then

    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    select fetched_tier, fetched_division, fetched_lp
    into v_latest_rank
    from public.order_rank_verifications
    where order_id = p_order_id order by created_at desc limit 1;

    v_latest_pdl := coalesce(v_latest_rank.fetched_lp, v_order.current_pdl, 0);
    v_new_current_pdl := v_latest_pdl;
    v_new_current_rank := case
      when v_latest_rank.fetched_tier is not null
        then jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division)
      else v_order.current_rank
    end;

    v_win_value_master_cents := public.win_price_cents(
      v_order.queue_type,
      v_order.boost_mode,
      coalesce(v_latest_rank.fetched_tier, v_order.current_rank->>'tier')
    );
    v_win_value_master_full  := v_win_value_master_cents / 100.0;
    -- Comissão fixa de 45% só neste ramo (negativo, quando o cliente pede) --
    -- diferente do share_pct dinâmico (55/60 top3) usado em todo o resto.
    v_win_value_master_share := round(v_win_value_master_full * 0.55, 2);

    if v_is_positive then
      v_cutoff_pdl := coalesce(
        (select cutoff_lp from public.riot_league_cutoffs
          where queue = v_order.queue_type and tier = v_order.target_rank->>'tier'),
        case v_order.target_rank->>'tier'
          when 'grandmaster' then 1200
          when 'challenger' then 2200
          else 0
        end
      );
      v_original_pdl := coalesce(v_order.current_pdl, 0);

      v_pdl_remaining := greatest(0, v_cutoff_pdl - v_original_pdl);
      v_quarter_pdl    := v_pdl_remaining / 4.0;
      v_booster_share  := round(v_order.total_price * v_share_pct, 2);
      v_quarter_value  := round(v_booster_share / 4.0, 2);

      v_quarters_completed := case
        when v_quarter_pdl <= 0 then 4
        else least(4, floor(greatest(0, v_latest_pdl - v_original_pdl) / v_quarter_pdl)::integer)
      end;

      v_payout := v_quarter_value * v_quarters_completed;
      -- total_price é o bruto pago pelo cliente. Remove a fração bruta
      -- concluída; subtrair v_payout aplicava a comissão uma segunda vez ao
      -- próximo booster.
      v_new_total_price := greatest(0, round(
        v_order.total_price * (1 - v_quarters_completed / 4.0), 2
      ));
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_master_full, v_win_value_master_share, v_order.losses_played);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Elo/Duo Boost -- padrão (abaixo de Mestre) ──────────────────────────
  elsif v_order.service_type = 'elo_boost' then
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    v_divisions_remaining := greatest(0,
      public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division')
      - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division'));

    v_division_value_full  := case when v_divisions_remaining > 0 then v_order.total_price / v_divisions_remaining else 0 end;
    v_division_value_share := round(v_division_value_full * v_share_pct, 2);

    select fetched_tier, fetched_division into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id order by created_at desc limit 1;

    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
      v_steps_crossed := greatest(0,
        public.rank_step(v_latest_rank.fetched_tier, v_latest_rank.fetched_division)
        - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division'));
    else
      v_new_current_rank := v_order.current_rank;
      v_steps_crossed := 0;
    end if;

    if v_is_positive then
      v_payout := round(v_division_value_share * v_steps_crossed, 2);
      -- O preço do pedido é bruto, portanto também precisa ser reduzido
      -- pelo valor bruto das divisões concluídas.
      v_new_total_price := greatest(0, round(
        v_order.total_price - (v_division_value_full * v_steps_crossed), 2
      ));
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role,
        round(v_division_value_full / 4.0, 2),
        round(v_division_value_share / 4.0, 2),
        v_order.losses_played);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Demais tipos (coaching, placement_matches, clash): sem fórmula
  -- específica no plano -- mantém o cálculo proporcional genérico de
  -- antes (completion_pct * share_pct), sem penalidade negativa. Coaching
  -- usa v_share_pct = 0.70 (fixo, ver acima); placement_matches/clash
  -- continuam em 0.55/0.60 por is_top3, sem taxa própria definida.
  --
  -- Coaching aceita um % de conclusão informado manualmente pelo admin
  -- (p_coaching_completion_pct) em vez do automático (sempre 0, sem métrica
  -- de sessões entregues) -- clash/placement_matches continuam 100%
  -- automáticos (ignoram o parâmetro, mesmo que informado por engano).
  else
    if v_order.service_type = 'coaching' and p_coaching_completion_pct is not null then
      v_completion_pct := greatest(0, least(100, p_coaching_completion_pct));
    else
      v_completion_pct := public.order_drop_completion_pct(p_order_id);
    end if;
    v_completion_frac := v_completion_pct / 100.0;
    v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
      else null
    end;
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_current_rank := v_order.current_rank;
    v_payout := round(v_order.total_price * v_share_pct * v_completion_frac, 2);
  end if;

  -- ── Aplica o resultado ao pedido ────────────────────────────────────
  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    total_price            = v_new_total_price,
    base_price             = v_new_total_price,
    extras_price           = 0,
    discount_price         = 0,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    current_pdl            = v_new_current_pdl,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id
    and booster_id = v_order.assigned_booster_id
    and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial pelo progresso entregue no pedido ' || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'R$ ' || v_payout::text || ' foi creditado ao seu saldo pelo progresso entregue antes do drop.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout)
    );
  end if;

  if v_penalty > 0 then
    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_penalty,
      'Penalidade por drop em desvantagem no pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Penalidade de drop aplicada',
      'R$ ' || v_penalty::text || ' foi descontado do seu saldo por dropar o pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_penalty)
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
    'success', true,
    'payout_amount', v_payout,
    'penalty_amount', v_penalty,
    'new_total_price', v_new_total_price,
    'is_positive', v_is_positive
  );
end;
$function$;

-- ── admin_drop_order: repassa o % de conclusão informado (coaching only) ──
create or replace function public.admin_drop_order(
  p_order_id uuid,
  p_reason   text,
  p_coaching_completion_pct numeric default null
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

  v_result := public.apply_order_drop(
    p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role,
    p_coaching_completion_pct
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_amount, status, admin_id, admin_note, resolved_at, requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(), 'admin'
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

-- ── resolve_drop_request: idem, só usado no ramo de aprovação ────────────
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null,
  p_coaching_completion_pct numeric default null
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

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    v_result := public.apply_order_drop(
      v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role,
      p_coaching_completion_pct
    );

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_amount = coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
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

-- ── admin_reassign_booster: mesma isenção de sync pra coaching que já
-- corrigimos em request_order_drop, + repassa o % de conclusão informado ──
create or replace function public.admin_reassign_booster(
  p_order_id uuid,
  p_target_booster_id uuid,
  p_reason text,
  p_coaching_completion_pct numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order              record;
  v_reason             text := coalesce(trim(p_reason), '');
  v_target             record;
  v_result             jsonb;
  v_is_new_assignment  boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, last_match_synced_at, customer_id, service_type
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  v_is_new_assignment := v_order.assigned_booster_id is null;

  if v_is_new_assignment then
    if v_order.status <> 'awaiting_assignment' then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
  else
    if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
    if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
      return jsonb_build_object('success', false, 'error', 'sync_required_before_reassign');
    end if;
    if v_order.assigned_booster_id = p_target_booster_id then
      return jsonb_build_object('success', false, 'error', 'already_assigned_to_target');
    end if;
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  if not v_is_new_assignment then
    v_result := public.apply_order_drop(
      p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role,
      p_coaching_completion_pct
    );

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;
  end if;

  update public.orders
  set preferred_booster_id = p_target_booster_id,
      -- Coaching é reserva permanente do dono do pacote (mesmo critério de
      -- _release_pending_review_order) -- nunca expira, mesmo reatribuído.
      exclusive_until      = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      reassigned_by_admin  = true,
      duo_own_riot_id      = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin',
    case when v_is_new_assignment then 'Um pedido foi reservado pra você' else 'Um pedido foi reatribuído a você' end,
    'Um administrador reservou este pedido pra você -- você tem 9 horas para aceitar na aba Jobs.'
      || case when v_reason <> '' then ' Motivo: ' || v_reason else '' end,
    jsonb_build_object('order_id', p_order_id)
  );

  if not v_is_new_assignment and v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Booster do seu pedido foi trocado',
      'Um administrador reatribuiu seu pedido para outro booster.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id,
                              'new_booster_id', p_target_booster_id, 'new_assignment', v_is_new_assignment,
                              'drop_result', v_result));

  if v_is_new_assignment then
    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-order-channel',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object(
        'record', jsonb_build_object(
          'id', p_order_id, 'status', 'awaiting_assignment',
          'discord_voice_channel_id', null, 'discord_text_channel_id', null
        ),
        'old_record', jsonb_build_object('status', 'assigned')
      ),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true, 'drop_result', v_result);
end;
$$;
