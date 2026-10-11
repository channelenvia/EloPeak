-- W-3: seguranca de acesso.
-- H-2 check_own_write_rate_limit nao e chamavel pelo client; H-14 RPCs admin/financeiras com rate limit;
-- H-3 booster nao aceita pedido proprio; H-4 service_role/cron nao sao barrados pelo trigger de status de booster;
-- M-17 admin_note/is_moderated fora do alcance de authenticated; L-2 can_booster_accept_order so para si/admin; L-4 stats so de boosters aprovados.
-- Mesmas assinaturas (CREATE OR REPLACE) -- sem overload orfao.
set search_path = public, extensions;

-- ===== H-2 =====
REVOKE EXECUTE ON FUNCTION public.check_own_write_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_own_write_rate_limit(text, integer, integer) TO service_role;

-- ===== H-14: rate limit server-side nas RPCs admin/financeiras chamadas do client =====

CREATE OR REPLACE FUNCTION public.admin_review_payout_request(p_request_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_new public.payout_request_status;
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_review_payout_request', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_new_status not in ('under_review', 'approved', 'rejected') then
    return jsonb_build_object('success', false, 'error', 'invalid_target_status');
  end if;
  v_new := p_new_status::public.payout_request_status;

  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  -- Dupla aprovacao: admin que tambem e booster nao aprova o proprio saque (rejeitar segue permitido: devolve a reserva).
  if v_new <> 'rejected' and v_req.booster_id = auth.uid() then
    return jsonb_build_object('success', false, 'error', 'cannot_review_own_request');
  end if;

  if v_new = 'rejected' then
    if v_req.status not in ('requested', 'under_review', 'approved') then
      return jsonb_build_object('success', false, 'error', 'invalid_status');
    end if;
  else
    if v_req.status not in ('requested', 'under_review')
       or (v_new = 'under_review' and v_req.status <> 'requested')
    then
      return jsonb_build_object('success', false, 'error', 'invalid_status');
    end if;
  end if;

  update public.payout_requests
    set status = v_new,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        admin_note = coalesce(p_note, admin_note),
        rejection_reason = case when v_new = 'rejected' then p_note else rejection_reason end,
        updated_at = now()
    where id = p_request_id;

  if v_new = 'rejected' then
    insert into public.booster_ledger_entries(
      booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_req.booster_id, p_request_id, 'payout_release', v_req.amount,
      'Solicitação de saque ' || p_request_id::text || ' rejeitada: ' || coalesce(p_note, 'sem motivo informado'),
      auth.uid(), 'admin'::public.user_role
    );
    insert into public.notifications(user_id, type, title, body, data)
    values (v_req.booster_id, 'payout_request_rejected', 'Solicitação de saque rejeitada',
            coalesce(p_note, 'Sua solicitação de saque foi rejeitada.'),
            jsonb_build_object('payout_request_id', p_request_id));
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin'::public.user_role, 'payout_request.' || p_new_status, 'payout_request', p_request_id::text,
          jsonb_build_object('note', p_note));

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(p_request_id uuid, p_proof_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_mark_payout_paid', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_proof_url is null or length(trim(p_proof_url)) = 0 then
    return jsonb_build_object('success', false, 'error', 'proof_required');
  end if;
  if p_proof_url not like p_request_id::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'payout-proofs' and o.name = p_proof_url) then
    return jsonb_build_object('success', false, 'error', 'invalid_proof');
  end if;

  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_req.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_req.booster_id = auth.uid() then
    return jsonb_build_object('success', false, 'error', 'cannot_review_own_request');
  end if;

  update public.payout_requests
    set status = 'paid', paid_at = now(), paid_by = auth.uid(), proof_url = p_proof_url, updated_at = now()
    where id = p_request_id;

  -- Lançamento informativo (valor 0): o débito real já ocorreu em
  -- 'payout_reservation' no momento da solicitação. Ver booster_payout_totals
  -- para a separação "reservado" vs. "pago" na exibição.
  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    v_req.booster_id, p_request_id, 'payout_paid', 0,
    'Solicitação de saque ' || p_request_id::text || ' paga', auth.uid(), 'admin'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin'::public.user_role, 'payout_request.paid', 'payout_request', p_request_id::text,
          jsonb_build_object('proof_url', p_proof_url));

  insert into public.notifications(user_id, type, title, body, data)
  values (v_req.booster_id, 'payout_request_paid', 'Saque pago',
          'Seu saque de R$ ' || v_req.amount::text || ' foi pago.',
          jsonb_build_object('payout_request_id', p_request_id));

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_confirm_manual_refund(p_refund_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refund public.refunds%rowtype;
  v_order  record;
  v_pay    record;
  v_new_refunded numeric;
  v_pay_status public.payment_status;
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_confirm_manual_refund', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  -- Mesma ordem de lock do webhook e da criacao: pedido, pagamento, reembolso.
  select id, status, customer_id into v_order from public.orders where id = v_refund.order_id for update;
  select id, amount, coalesce(refunded_amount, 0) as refunded_amount into v_pay
    from public.payments where id = v_refund.payment_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;
  v_new_refunded := v_pay.refunded_amount + v_refund.amount;
  if v_new_refunded > v_pay.amount then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  update public.refunds set status = 'succeeded' where id = v_refund.id;

  v_pay_status := case when v_new_refunded >= v_pay.amount then 'refunded' else 'partially_refunded' end;
  update public.payments set refunded_amount = v_new_refunded, status = v_pay_status, updated_at = now()
   where id = v_pay.id;

  -- O webhook do Mercado Pago pode ter reembolsado o pedido no meio tempo.
  if v_order.status not in ('refunded', 'canceled') then
    update public.orders set status = 'refunded'::public.order_status, payment_status = v_pay_status, updated_at = now()
     where id = v_order.id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_order.id, v_order.status, 'refunded'::public.order_status, auth.uid(),
            'Reembolso confirmado: ' || v_refund.reason);
  else
    update public.orders set payment_status = v_pay_status, updated_at = now() where id = v_order.id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_confirmed', 'order', v_order.id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount, 'payment_status', v_pay_status));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.customer_id, 'order_status_changed', 'Reembolso processado',
            'R$ ' || v_refund.amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_refund.reason,
            jsonb_build_object('order_id', v_order.id, 'amount', v_refund.amount));
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_cancel_manual_refund(p_refund_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refund public.refunds%rowtype;
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_cancel_manual_refund', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  perform 1 from public.orders where id = v_refund.order_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;

  update public.refunds set status = 'failed' where id = v_refund.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_canceled', 'order', v_refund.order_id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_pending_review_lock(p_order_id uuid, p_locked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_set_pending_review_lock', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status, assigned_booster_id into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  if p_locked then
    update public.orders set admin_review_locked = true, updated_at = now() where id = p_order_id;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_locked', 'order', p_order_id::text, '{}'::jsonb);
  else
    if v_order.assigned_booster_id is null and exists (select 1 from public.refunds where order_id = p_order_id and status = 'pending') then
      return jsonb_build_object('success', false, 'error', 'refund_pending');
    end if;
    perform public._release_pending_review_order(p_order_id, auth.uid(), 'Liberado manualmente pelo admin');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_unlocked', 'order', p_order_id::text, '{}'::jsonb);
  end if;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_order_chat_lock(p_order_id uuid, p_locked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if auth.uid() is not null and not public.check_own_write_rate_limit('admin_set_order_chat_lock', 30, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas tentativas. Aguarde um minuto.');
  end if;
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('success', false, 'code', 'forbidden', 'message', 'Apenas administradores podem controlar o chat.');
  end if;

  update public.orders
  set chat_locked = p_locked,
      chat_locked_by = case when p_locked then v_user_id else null end,
      chat_locked_at = case when p_locked then now() else null end,
      updated_at = now()
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (
    v_user_id,
    'admin'::public.user_role,
    case when p_locked then 'order_chat_locked' else 'order_chat_unlocked' end,
    'order',
    p_order_id,
    jsonb_build_object('chat_locked', p_locked)
  );

  return jsonb_build_object('success', true, 'chat_locked', p_locked);
end;
$function$
;

-- ===== H-3 =====
CREATE OR REPLACE FUNCTION public.accept_boost_order(p_order_id uuid, p_booster_user_id uuid, p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Termos vigentes aceitos (relogio e versao do servidor; antes do captcha para nao queimar o desafio).
  if not exists (
    select 1 from public.profiles
    where id = p_booster_user_id
      and terms_accepted_at is not null and privacy_accepted_at is not null
      and legal_version = public.current_legal_version()
  ) then
    return jsonb_build_object('success', false, 'error', 'legal_not_accepted');
  end if;

  -- RN-12: so aceita com um desafio resolvido no servidor (uso unico, TTL curto, do mesmo booster e pedido).
  update public.accept_challenges
     set used_at = now()
   where id = p_challenge_id and booster_id = p_booster_user_id and order_id = p_order_id
     and solved_at is not null and used_at is null and expires_at > now();
  if not found then
    return jsonb_build_object('success', false, 'error', 'captcha_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set, reassigned_by_admin, customer_id
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  -- H-3: ninguem aceita (nem avalia) o proprio pedido.
  if v_order.customer_id = p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'own_order');
  end if;
  if not public.is_approved_booster(p_booster_user_id) then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if v_order.preferred_booster_id is distinct from p_booster_user_id and exists (
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
     and v_order.preferred_booster_id <> p_booster_user_id
     and (
       v_order.service_type = 'coaching'
       or (v_order.exclusive_until is not null and v_order.exclusive_until > now())
     ) then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  if v_order.service_type = 'coaching' and v_order.preferred_booster_id = p_booster_user_id then
    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido de coaching reatribuído' else 'Booster aceitou o pedido de coaching' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', false, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null and v_order.exclusive_until > now();

  if v_is_exclusive then
    if not v_order.reassigned_by_admin and public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        used_exclusive_slot = not v_order.reassigned_by_admin,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido reatribuído' else 'Booster aceitou o pedido exclusivo' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', not v_order.reassigned_by_admin, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  -- H-11: accept pelo pool (fora da exclusividade) consome slot; zera a isencao da reatribuicao.
  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      reassigned_by_admin = false,
      match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
  where id = p_order_id;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$function$
;

CREATE OR REPLACE VIEW public.available_boost_orders WITH (security_barrier = true) AS
SELECT id,
    service_id,
    game_id,
    status,
    queue_type,
    boost_mode,
    server,
    current_rank,
    target_rank,
    wins_purchased,
    sessions_purchased,
    win_package,
    extras,
    total_price,
    estimated_hours,
    wins_played,
    losses_played,
    current_pdl,
    pdl_bracket,
    avg_pdl_gain,
    avg_pdl_loss,
    pricing_version,
    created_at,
    updated_at,
    preferred_booster_id,
    exclusive_until,
    drop_count,
    rank_before_last_drop,
    last_dropped_at,
    service_type,
    clash_tier,
    clash_day,
    customer_lanes,
    booster_service_id,
    reassigned_by_admin,
    rank_source
   FROM orders
  WHERE ((status = 'awaiting_assignment'::order_status) AND (assigned_booster_id IS NULL) AND (customer_id <> auth.uid()) AND is_approved_booster() AND ((NOT order_requires_access_token(service_type, boost_mode)) OR (credentials_set = true)) AND
        CASE
            WHEN (service_type = 'coaching'::service_type) THEN (preferred_booster_id = auth.uid())
            ELSE ((preferred_booster_id IS NULL) OR (exclusive_until IS NULL) OR (exclusive_until <= now()) OR (preferred_booster_id = auth.uid()))
        END AND ((preferred_booster_id = auth.uid()) OR (NOT (EXISTS ( SELECT 1
           FROM order_drop_requests dr
          WHERE ((dr.order_id = orders.id) AND (dr.booster_id = auth.uid()) AND (dr.status = 'approved'::text)))))));

-- ===== H-4: sem JWT de usuario (service_role/cron) o trigger nao barra =====
CREATE OR REPLACE FUNCTION public.prevent_non_admin_booster_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.status is distinct from old.status and not public.is_admin() and auth.uid() is not null
     and not (old.status = 'rejected' and new.status = 'pending' and old.user_id = auth.uid()) then
    raise exception 'only admins can change booster application status';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.booster_available_balance(p_booster_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() = p_booster_id or public.is_admin() or coalesce(auth.role(), 'service_role') = 'service_role'
      then coalesce((select sum(amount) from public.booster_ledger_entries where booster_id = p_booster_id), 0)
    else null
  end;
$function$
;

-- ===== L-2 =====
CREATE OR REPLACE FUNCTION public.can_booster_accept_order(p_booster_user_id uuid, p_boost_mode text, p_service_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_top3         boolean;
  v_max_total       integer;
  v_solo_count      integer;
  v_duo_count       integer;
  v_total_count     integer;
  v_exclusive_used  boolean;
begin
  -- L-2: sem oraculo "UUID e booster aprovado" (aprovado ja dava 'forbidden' via booster_active_slot_counts): so si mesmo/admin/interno.
  if auth.uid() is not null and auth.uid() <> p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select is_top3 into v_is_top3
  from public.booster_profiles
  where user_id = p_booster_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'booster_not_approved');
  end if;

  v_max_total := case when v_is_top3 then 4 else 3 end;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  v_exclusive_used := public.booster_has_active_exclusive_slot(p_booster_user_id);

  if p_service_type = 'coaching' then
    return jsonb_build_object(
      'allowed', true,
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'is_top3', v_is_top3,
    'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
  );
end;
$function$
;


-- ===== M-17: moderacao so por RPC admin; authenticated perde admin_note/is_moderated =====
CREATE OR REPLACE FUNCTION public.admin_list_reviews(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, order_id uuid, booster_id uuid, rating integer, content text, is_public boolean,
               is_moderated boolean, admin_note text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
    select r.id, r.order_id, r.booster_id, r.rating::integer, r.content, r.is_public, r.is_moderated, r.admin_note, r.created_at
      from public.reviews r
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_reviews(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reviews(integer) TO authenticated, service_role;

REVOKE SELECT ON public.reviews FROM authenticated;
GRANT SELECT (id, order_id, booster_id, customer_id, rating, content, is_public, created_at) ON public.reviews TO authenticated;

-- ===== L-4: stats publicas so de boosters aprovados (o proprio booster e admin veem as suas) =====
CREATE OR REPLACE FUNCTION public.is_approved_booster_user(p_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.booster_profiles where user_id = p_user_id and status = 'approved') $$;
REVOKE ALL ON FUNCTION public.is_approved_booster_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_booster_user(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.customer_has_booster_order(p_booster_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select auth.uid() is not null and exists (
  select 1 from public.orders where assigned_booster_id = p_booster_id and customer_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION public.customer_has_booster_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_has_booster_order(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS booster_performance_segments_read ON public.booster_performance_segments;
CREATE POLICY booster_performance_segments_read ON public.booster_performance_segments FOR SELECT TO public
  USING (public.is_approved_booster_user(booster_id) OR booster_id = auth.uid() OR public.is_admin()
         OR public.customer_has_booster_order(booster_id));
DROP POLICY IF EXISTS booster_champion_stats_read ON public.booster_champion_stats;
CREATE POLICY booster_champion_stats_read ON public.booster_champion_stats FOR SELECT TO public
  USING (public.is_approved_booster_user(booster_id) OR booster_id = auth.uid() OR public.is_admin()
         OR public.customer_has_booster_order(booster_id));
