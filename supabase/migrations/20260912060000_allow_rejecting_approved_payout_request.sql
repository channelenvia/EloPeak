-- Bug: once a payout_request reaches 'approved', admin_review_payout_request
-- refuses every further transition ("v_req.status not in ('requested',
-- 'under_review')" also gates the 'rejected' target), and
-- cancel_payout_request only lets the booster cancel from 'requested'/
-- 'under_review'. So an approved request can only ever go to 'paid' --
-- there is no way to release the reservation if the admin needs to reverse
-- an approval (fraud found, wrong CPF, duplicate request, etc). The
-- reservation permanently locks that slice of the booster's balance.
-- The frontend already assumed this was possible: Payouts.tsx keeps the
-- reject form under `isPending` (which includes 'approved'), it's only
-- `canReject` that excludes it -- a real gap, not a UI oversight.
--
-- Fix: let 'rejected' be reached from 'approved' too (same ledger release +
-- notification code path already used for requested/under_review). Leaves
-- 'under_review'/'approved' targets exactly as restrictive as before.
create or replace function public.admin_review_payout_request(
  p_request_id uuid, p_new_status text, p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
$$;
