-- L-13: dupla aprovacao (admin que tambem e booster nao aprova/paga o proprio saque nem ajusta o proprio saldo).
-- L-14: delete_duo_account trava a linha (FOR UPDATE) e o limite de 1 Clash ativo passa a valer tambem em UPDATE.
-- Mesmas assinaturas: CREATE OR REPLACE (sem overload orfao).

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
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(p_request_id uuid, p_proof_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
begin
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_booster_balance(p_booster_id uuid, p_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_booster_id = auth.uid() then
    return jsonb_build_object('success', false, 'error', 'cannot_adjust_own_balance');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 or p_amount <> round(p_amount, 2) then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if not public.check_own_write_rate_limit('admin_adjust_booster_balance', 30, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform 1 from public.booster_profiles where user_id = p_booster_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  insert into public.booster_ledger_entries(booster_id, entry_type, amount, description, actor_id, actor_role)
  values (p_booster_id, 'manual_admin_adjustment', p_amount, v_reason, auth.uid(), 'admin'::public.user_role);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'booster.manual_balance_adjustment', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_booster_id, 'order_status_changed', 'Ajuste de saldo',
    (case when p_amount > 0 then 'R$ ' || p_amount::text || ' foi creditado ao seu saldo pela administração.'
          else 'R$ ' || abs(p_amount)::text || ' foi descontado do seu saldo pela administração.' end)
      || ' Motivo: ' || v_reason,
    jsonb_build_object('amount', p_amount)
  );

  return jsonb_build_object('success', true, 'new_balance', public.booster_available_balance(p_booster_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_duo_account(p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reserved_by uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select reserved_by into v_reserved_by from public.duo_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_reserved_by is not null then
    return jsonb_build_object('success', false, 'error', 'account_reserved');
  end if;

  delete from public.duo_accounts where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.deleted', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_cap_active_clash_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing boolean;
begin
  -- Em UPDATE so vale quando o pedido passa a ser um Clash ativo (reativar/trocar dono/tipo).
  if new.service_type = 'clash' and new.status not in ('completed', 'canceled', 'refunded') then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 2));

    select exists (
      select 1 from public.orders
      where customer_id = new.customer_id
        and service_type = 'clash'
        and status not in ('completed', 'canceled', 'refunded')
        and id <> new.id
    ) into v_existing;

    if v_existing then
      raise exception 'active_clash_order_exists' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_cap_active_clash_orders on public.orders;
create trigger trg_cap_active_clash_orders
  before insert or update of status, service_type, customer_id on public.orders
  for each row execute function public.trg_fn_cap_active_clash_orders();
