-- Substitui o modelo de repasse "um payout_records por pedido, editado via
-- UPDATE direto por RLS (payout_records_admin_update), sem trilha de
-- auditoria" por um ledger financeiro imutável + fila de solicitações de
-- saque (payout_requests), com prova de pagamento obrigatória antes de
-- marcar como pago. payout_records é preservado como registro histórico
-- por pedido (detalhe de composição de uma solicitação) -- não é mais o
-- mecanismo de pagamento em si.
--
-- Convenção de sinal: todo amount em booster_ledger_entries já vem com o
-- sinal correto para o saldo (créditos positivos, débitos negativos), então
-- available_balance = soma bruta de todos os lançamentos do booster, sem
-- nenhuma lógica condicional por status. 'payout_paid' é um lançamento
-- informativo de valor zero (o débito real já aconteceu em
-- 'payout_reservation'; ver booster_payout_totals para a métrica "total
-- pago" separada, calculada via join com payout_requests.status).

create type public.ledger_entry_type as enum (
  'commission_credit',
  'commission_adjustment',
  'drop_penalty',
  'refund_debit',
  'manual_admin_adjustment',
  'payout_reservation',
  'payout_release',
  'payout_paid'
);

create type public.payout_request_status as enum (
  'requested', 'under_review', 'approved', 'paid', 'rejected', 'canceled'
);

create table public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  booster_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null,
  status public.payout_request_status not null default 'requested',
  booster_cpf_snapshot text,
  booster_legal_name_snapshot text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  admin_note text,
  rejection_reason text,
  proof_url text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_requests_amount_positive check (amount > 0),
  constraint payout_requests_paid_requires_proof
    check (status <> 'paid' or proof_url is not null)
);

create index payout_requests_booster_idx on public.payout_requests(booster_id);
create index payout_requests_status_idx on public.payout_requests(status);

create table public.booster_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  booster_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  payout_request_id uuid references public.payout_requests(id),
  entry_type public.ledger_entry_type not null,
  amount numeric(10,2) not null,
  description text,
  actor_id uuid,
  actor_role public.user_role,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index booster_ledger_entries_booster_idx on public.booster_ledger_entries(booster_id, created_at desc);
create index booster_ledger_entries_order_idx on public.booster_ledger_entries(order_id) where order_id is not null;
create index booster_ledger_entries_payout_request_idx on public.booster_ledger_entries(payout_request_id) where payout_request_id is not null;

comment on table public.booster_ledger_entries is
  'Ledger financeiro imutável do booster. available_balance = soma bruta de '
  'amount de todos os lançamentos -- todo INSERT já grava o sinal correto '
  '(créditos positivos, débitos negativos). Sem policy de UPDATE/DELETE para '
  'nenhum papel -- só é escrito por funções SECURITY DEFINER.';

alter table public.payout_requests enable row level security;
alter table public.booster_ledger_entries enable row level security;

create policy "payout_requests_read" on public.payout_requests
  for select using (booster_id = auth.uid() or public.is_admin());

create policy "booster_ledger_entries_read" on public.booster_ledger_entries
  for select using (booster_id = auth.uid() or public.is_admin());

-- Nenhuma policy de INSERT/UPDATE/DELETE nas duas tabelas: toda escrita
-- passa pelas funções SECURITY DEFINER abaixo (mesmo padrão de orders, que
-- não tem policy de INSERT e é escrita só via Edge Function/RPC).

grant select on public.payout_requests to authenticated;
grant select on public.booster_ledger_entries to authenticated;

-- ── Saldo disponível e totais ────────────────────────────────────────────

create or replace function public.booster_available_balance(p_booster_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.booster_ledger_entries where booster_id = p_booster_id;
$$;

revoke all on function public.booster_available_balance(uuid) from public, anon;
grant execute on function public.booster_available_balance(uuid) to authenticated, service_role;

create or replace function public.booster_payout_totals(p_booster_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (auth.uid() = p_booster_id or public.is_admin()) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'success', true,
    'available_balance', public.booster_available_balance(p_booster_id),
    'total_earned', coalesce((
      select sum(amount) from public.booster_ledger_entries
      where booster_id = p_booster_id and entry_type = 'commission_credit'
    ), 0),
    'reserved', coalesce((
      select sum(le.amount) * -1 from public.booster_ledger_entries le
      join public.payout_requests pr on pr.id = le.payout_request_id
      where le.booster_id = p_booster_id and le.entry_type = 'payout_reservation'
        and pr.status in ('requested', 'under_review', 'approved')
    ), 0),
    'total_paid', coalesce((
      select sum(le.amount) * -1 from public.booster_ledger_entries le
      join public.payout_requests pr on pr.id = le.payout_request_id
      where le.booster_id = p_booster_id and le.entry_type = 'payout_reservation'
        and pr.status = 'paid'
    ), 0)
  );
end;
$$;

revoke all on function public.booster_payout_totals(uuid) from public, anon;
grant execute on function public.booster_payout_totals(uuid) to authenticated, service_role;

-- ── Crédito de comissão ao concluir pedido (estende migration 069) ──────

create or replace function public.trg_fn_order_completed_booster_stats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_top3           boolean;
  v_commission_rate   numeric(5,4);
  v_commission_amount numeric(10,2);
  v_net_amount        numeric(10,2);
  v_payout_record_id  uuid;
begin
  if NEW.status = 'completed'
     and OLD.status is distinct from 'completed'
     and NEW.assigned_booster_id is not null
  then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles
      where user_id = NEW.assigned_booster_id;

    v_commission_rate := case when v_is_top3 then 0.40 else 0.45 end;
    v_commission_amount := round(NEW.total_price * v_commission_rate, 2);
    v_net_amount := NEW.total_price - v_commission_amount;

    update public.booster_profiles
      set total_completed = total_completed + 1,
          total_earnings  = total_earnings + v_net_amount
      where user_id = NEW.assigned_booster_id;

    insert into public.payout_records(
      booster_id, order_id, gross_amount, commission_rate, commission_amount, net_amount, status
    ) values (
      NEW.assigned_booster_id, NEW.id, NEW.total_price, v_commission_rate, v_commission_amount, v_net_amount, 'pending'
    )
    returning id into v_payout_record_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description
    ) values (
      NEW.assigned_booster_id, NEW.id, 'commission_credit', v_net_amount,
      'Comissão do pedido ' || NEW.id::text || ' (' || (v_commission_rate::numeric * 100)::text || '% de comissão da plataforma) -- gerado automaticamente pelo trigger de conclusão de pedido'
    );
  end if;
  return NEW;
end;
$$;

-- ── Solicitação de saque (booster) ───────────────────────────────────────

create or replace function public.request_payout(p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
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
$$;

revoke all on function public.request_payout(numeric) from public, anon;
grant execute on function public.request_payout(numeric) to authenticated;

-- ── Cancelamento pelo próprio booster ────────────────────────────────────

create or replace function public.cancel_payout_request(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null or v_req.booster_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_req.status not in ('requested', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.payout_requests
    set status = 'canceled', updated_at = now()
    where id = p_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    v_req.booster_id, p_request_id, 'payout_release', v_req.amount,
    'Solicitação de saque ' || p_request_id::text || ' cancelada pelo booster', auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.canceled', 'payout_request', p_request_id::text);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_payout_request(uuid) from public, anon;
grant execute on function public.cancel_payout_request(uuid) to authenticated;

-- ── Revisão administrativa (under_review / approved / rejected) ─────────

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
  if v_req.status not in ('requested', 'under_review')
     or (v_new = 'under_review' and v_req.status <> 'requested')
  then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
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

revoke all on function public.admin_review_payout_request(uuid, text, text) from public, anon;
grant execute on function public.admin_review_payout_request(uuid, text, text) to authenticated;

-- ── Marcar como pago (exige prova) ───────────────────────────────────────

create or replace function public.admin_mark_payout_paid(p_request_id uuid, p_proof_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_proof_url is null or length(trim(p_proof_url)) = 0 then
    return jsonb_build_object('success', false, 'error', 'proof_required');
  end if;

  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_req.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
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
$$;

revoke all on function public.admin_mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.admin_mark_payout_paid(uuid, text) to authenticated;

-- ── Detalhe de composição (FIFO best-effort, só para exibição) ──────────
-- A retirada em si é sobre saldo fungível (não amarra pedidos específicos a
-- uma solicitação) -- esta função reconstrói, para a tela de detalhe do
-- admin, quais pedidos "compõem" aproximadamente uma solicitação, andando
-- em ordem cronológica pelos pedidos concluídos do booster e descontando o
-- que solicitações anteriores (não rejeitadas/canceladas) já consumiram.

create or replace function public.payout_request_order_breakdown(p_request_id uuid)
returns table(
  order_id uuid,
  service_type public.service_type,
  gross_amount numeric,
  commission_rate numeric,
  booster_commission numeric,
  amount_included numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_req record;
  v_prior_consumed numeric;
  v_running numeric := 0;
  v_remaining numeric;
  v_row record;
  v_amount_included numeric;
begin
  select * into v_req from public.payout_requests where id = p_request_id;
  if v_req is null or not (public.is_admin() or v_req.booster_id = auth.uid()) then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_prior_consumed
  from public.payout_requests
  where booster_id = v_req.booster_id
    and status not in ('rejected', 'canceled')
    and (created_at, id) < (v_req.created_at, v_req.id);

  v_remaining := v_req.amount;

  for v_row in (
    select pr.order_id as o_id, o.service_type as s_type, pr.gross_amount as g_amount,
           pr.commission_rate as c_rate, pr.net_amount as commission
    from public.payout_records pr
    join public.orders o on o.id = pr.order_id
    where pr.booster_id = v_req.booster_id
    order by pr.created_at asc
  ) loop
    v_running := v_running + v_row.commission;
    if v_running <= v_prior_consumed or v_remaining <= 0 then
      continue;
    end if;
    v_amount_included := least(v_row.commission, v_remaining, v_running - v_prior_consumed);
    v_remaining := v_remaining - v_amount_included;
    order_id := v_row.o_id;
    service_type := v_row.s_type;
    gross_amount := v_row.g_amount;
    commission_rate := v_row.c_rate;
    booster_commission := v_row.commission;
    amount_included := v_amount_included;
    return next;
  end loop;
end;
$$;

revoke all on function public.payout_request_order_breakdown(uuid) from public, anon;
grant execute on function public.payout_request_order_breakdown(uuid) to authenticated;
