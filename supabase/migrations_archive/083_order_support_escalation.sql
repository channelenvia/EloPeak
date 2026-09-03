-- Suporte a "pedido atrasado": hoje o prazo (match_sync_started_at +
-- estimated_hours, ver CountdownTimer.tsx) só é calculado no browser, que
-- então mostra um link estático de Discord (VITE_DISCORD_TICKET_URL) sem
-- nenhum registro no backend. Isto adiciona o registro/idempotência/
-- auditoria que faltam -- o cálculo do prazo em si continua sendo o mesmo
-- (replicado aqui em SQL para o backend concordar com o frontend), e o link
-- de Discord em si continua vindo do frontend (não é segredo).

create table public.order_support_escalations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  delay_minutes integer not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create unique index order_support_escalations_open_idx
  on public.order_support_escalations(order_id) where status = 'open';
create index order_support_escalations_order_idx on public.order_support_escalations(order_id);

alter table public.order_support_escalations enable row level security;

create policy "order_support_escalations_read" on public.order_support_escalations
  for select using (
    customer_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.assigned_booster_id = auth.uid())
  );

grant select on public.order_support_escalations to authenticated;

create or replace function public.request_order_support(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_deadline timestamptz;
  v_existing record;
  v_escalation_id uuid;
  v_delay_minutes integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, customer_id, status, match_sync_started_at, estimated_hours, discord_voice_channel_id
    into v_order
    from public.orders
    where id = p_order_id;

  if v_order is null or v_order.customer_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_order.status in ('completed', 'canceled', 'refunded', 'disputed', 'draft', 'awaiting_payment') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.match_sync_started_at is null or v_order.estimated_hours is null then
    return jsonb_build_object('success', false, 'error', 'no_deadline_yet');
  end if;

  v_deadline := v_order.match_sync_started_at + (v_order.estimated_hours || ' hours')::interval;
  if now() <= v_deadline then
    return jsonb_build_object('success', false, 'error', 'not_late_yet', 'deadline_at', v_deadline);
  end if;

  -- Idempotente: um clique repetido no botão reaproveita a escalação aberta
  -- em vez de criar um registro novo a cada clique.
  select * into v_existing
    from public.order_support_escalations
    where order_id = p_order_id and status = 'open';

  if v_existing is not null then
    return jsonb_build_object(
      'success', true, 'escalation_id', v_existing.id, 'already_open', true,
      'deadline_at', v_existing.deadline_at, 'delay_minutes', v_existing.delay_minutes,
      'discord_voice_channel_id', v_order.discord_voice_channel_id
    );
  end if;

  v_delay_minutes := greatest(0, floor(extract(epoch from (now() - v_deadline)) / 60))::integer;

  insert into public.order_support_escalations(order_id, customer_id, deadline_at, delay_minutes)
  values (p_order_id, auth.uid(), v_deadline, v_delay_minutes)
  returning id into v_escalation_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'customer'::public.user_role, 'order.support_escalated', 'order', p_order_id::text,
          jsonb_build_object('escalation_id', v_escalation_id, 'delay_minutes', v_delay_minutes));

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'order_support_escalated', 'Pedido atrasado — suporte acionado',
         'Cliente abriu suporte para um pedido com ' || v_delay_minutes || ' minutos de atraso.',
         jsonb_build_object('order_id', p_order_id, 'escalation_id', v_escalation_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object(
    'success', true, 'escalation_id', v_escalation_id, 'already_open', false,
    'deadline_at', v_deadline, 'delay_minutes', v_delay_minutes,
    'discord_voice_channel_id', v_order.discord_voice_channel_id
  );
end;
$$;

revoke all on function public.request_order_support(uuid) from public, anon;
grant execute on function public.request_order_support(uuid) to authenticated;

-- Admin fecha a escalação (independente do que aconteça com o pedido em
-- si -- só marca que o suporte tratou o caso).
create or replace function public.admin_resolve_order_support(p_escalation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  update public.order_support_escalations
    set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_escalation_id and status = 'open';

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found_or_already_resolved');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'order.support_resolved', 'order_support_escalation', p_escalation_id::text);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_resolve_order_support(uuid) from public, anon;
grant execute on function public.admin_resolve_order_support(uuid) to authenticated;
