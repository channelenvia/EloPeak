-- Saques de boosters só podem ser solicitados nos dias 15 e 30 de cada mês
-- (fuso America/Sao_Paulo, mesma janela usada pelo cron
-- discord-top3-announcement -- migration 156). O front-end já esconde o
-- formulário de solicitação fora dessa janela, mas o RPC é a barreira que
-- vale de verdade -- sem ela, qualquer chamada direta à API do Supabase
-- ainda conseguiria solicitar saque em qualquer dia.
create or replace function public.request_payout(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
  v_min_amount constant numeric := 50.00;
  v_withdrawal_day int;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if p_amount < v_min_amount then
    return jsonb_build_object('success', false, 'error', 'below_minimum_amount', 'minimum', v_min_amount);
  end if;

  v_withdrawal_day := extract(day from (now() at time zone 'America/Sao_Paulo'));
  if v_withdrawal_day not in (15, 30) then
    return jsonb_build_object('success', false, 'error', 'withdrawal_window_closed');
  end if;

  -- Serializa solicitações concorrentes do mesmo booster (evita duas
  -- requisições simultâneas passarem ambas no cheque de saldo antes de
  -- qualquer uma commitar).
  select * into v_booster from public.booster_profiles where user_id = auth.uid() for update;
  if v_booster is null or v_booster.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;

  v_available := public.booster_available_balance(auth.uid());
  if p_amount > v_available then
    return jsonb_build_object('success', false, 'error', 'insufficient_balance', 'available', v_available);
  end if;

  insert into public.payout_requests(
    booster_id, amount, booster_cpf_snapshot, booster_legal_name_snapshot
  ) values (
    auth.uid(), p_amount, v_booster.cpf, v_booster.full_name
  )
  returning id into v_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    auth.uid(), v_request_id, 'payout_reservation', -p_amount,
    'Reserva para solicitação de saque ' || v_request_id::text, auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.created', 'payout_request', v_request_id::text,
          jsonb_build_object('amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'payout_request_created', 'Nova solicitação de saque',
         'Um booster solicitou saque de R$ ' || p_amount::text,
         jsonb_build_object('payout_request_id', v_request_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true, 'request_id', v_request_id);
end;
$function$;
