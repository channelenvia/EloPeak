-- Histórico de reservas de conta Duo -- até aqui, duo_accounts só guardava a
-- reserva ATUAL (reserved_by/reserved_order_id/reserved_at, zerados na
-- liberação); não havia como responder "quem reservou isso antes, por
-- quanto tempo, pra qual pedido" depois que a reserva já tinha sido
-- liberada. audit_logs quase cobria isso, mas release_duo_account_reservation
-- (o caminho mais comum, o próprio booster liberando) nunca gravava nada lá
-- -- por isso uma tabela dedicada, não uma consulta em cima do audit log.
create table public.duo_account_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.duo_accounts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  booster_id uuid not null references public.booster_profiles(user_id) on delete cascade,
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null
);

create index duo_account_reservations_account_idx
  on public.duo_account_reservations(account_id, reserved_at desc);

-- No máximo uma reserva ABERTA por conta ao mesmo tempo -- índice parcial em
-- vez de constraint normal porque released_at é null só enquanto está aberta.
create unique index duo_account_reservations_one_open_idx
  on public.duo_account_reservations(account_id) where released_at is null;

alter table public.duo_account_reservations enable row level security;

create policy "duo_account_reservations_admin_read" on public.duo_account_reservations
  for select using (public.is_admin());

revoke all on public.duo_account_reservations from public, anon;
grant select on public.duo_account_reservations to authenticated;
grant insert, update, select on public.duo_account_reservations to service_role;

-- ─── reserve_duo_account: agora também abre/fecha linhas de histórico ──────

create or replace function public.reserve_duo_account(p_order_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_previous_account_id uuid;
  v_reserved_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id, boost_mode, status, wins_played, losses_played into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_order_status');
  end if;

  select id into v_previous_account_id
  from public.duo_accounts where reserved_order_id = p_order_id for update;

  if v_previous_account_id is not null and v_previous_account_id = p_account_id then
    return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', true);
  end if;

  if v_previous_account_id is not null and (coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0)) > 0 then
    return jsonb_build_object('success', false, 'error', 'cannot_switch_after_matches_played');
  end if;

  if v_previous_account_id is not null then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = auth.uid(), last_released_at = now()
    where id = v_previous_account_id;

    update public.duo_account_reservations
    set released_at = now(), released_by = auth.uid()
    where account_id = v_previous_account_id and released_at is null;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'booster'::public.user_role, 'duo_account.switched', 'order', p_order_id,
            jsonb_build_object('from_account_id', v_previous_account_id, 'to_account_id', p_account_id,
                                'order_status_at_switch', v_order.status));
  end if;

  update public.duo_accounts
  set reserved_by = auth.uid(), reserved_order_id = p_order_id, reserved_at = now()
  where id = p_account_id
    and reserved_by is null
    and is_active = true
    and public.duo_account_rank_is_valid(current_rank)
  returning id into v_reserved_id;

  if v_reserved_id is null then
    return jsonb_build_object('success', false, 'error', 'account_unavailable');
  end if;

  insert into public.duo_account_reservations(account_id, order_id, booster_id)
  values (p_account_id, p_order_id, auth.uid());

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'duo_account.reserved', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', false);
end;
$$;

-- ─── release_duo_account_reservation: fecha a linha de histórico aberta ────

create or replace function public.release_duo_account_reservation(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_account_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id into v_order from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id into v_account_id from public.duo_accounts where reserved_order_id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null,
      last_released_by = reserved_by, last_released_at = now()
  where reserved_order_id = p_order_id;

  if v_account_id is not null then
    update public.duo_account_reservations
    set released_at = now(), released_by = auth.uid()
    where account_id = v_account_id and released_at is null;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── admin_release_duo_account: idem, ator é o admin ───────────────────────

create or replace function public.admin_release_duo_account(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null,
      last_released_by = reserved_by, last_released_at = now()
  where id = p_account_id;

  if not found then return jsonb_build_object('success', false, 'error', 'account_not_found'); end if;

  update public.duo_account_reservations
  set released_at = now(), released_by = auth.uid()
  where account_id = p_account_id and released_at is null;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'duo_account.admin_released', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- ─── list_duo_accounts: inclui o nome do booster que reservou (admin) ──────

create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_accounts jsonb;
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'game_id', d.game_id, 'label', d.label, 'riot_id', d.riot_id,
      'current_rank', d.current_rank, 'notes', d.notes, 'is_active', d.is_active,
      'created_by', d.created_by, 'created_at', d.created_at, 'updated_at', d.updated_at,
      'has_credentials', d.encrypted_credentials is not null,
      'reserved_by', d.reserved_by, 'reserved_order_id', d.reserved_order_id, 'reserved_at', d.reserved_at,
      'reserved_by_name', bp.display_name
    ) order by d.created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts d
    left join public.booster_profiles bp on bp.user_id = d.reserved_by;
  else
    select exists (
      select 1 from public.booster_profiles
      where user_id = auth.uid() and status = 'approved'
    ) into v_is_booster;

    if not v_is_booster then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'riot_id', riot_id, 'current_rank', current_rank, 'is_active', is_active,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts
    where is_active = true
      and encrypted_credentials is not null
      and (reserved_by is null or reserved_by = auth.uid());
  end if;

  return jsonb_build_object('success', true, 'accounts', v_accounts);
end;
$$;

-- ─── get_duo_account_reservation_history: modal do admin ──────────────────

create or replace function public.get_duo_account_reservation_history(p_account_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select jsonb_build_object(
    'success', true,
    'stats', (
      select jsonb_build_object(
        'total_reservations', count(*),
        'total_seconds', coalesce(sum(extract(epoch from (coalesce(released_at, now()) - reserved_at))), 0),
        'distinct_boosters', count(distinct booster_id)
      )
      from public.duo_account_reservations where account_id = p_account_id
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'reserved_at', h.reserved_at,
        'released_at', h.released_at,
        'booster_id', h.booster_id,
        'booster_name', bp.display_name,
        'order_id', h.order_id,
        'order_service_type', o.service_type,
        'order_status', o.status
      ) order by h.reserved_at desc), '[]'::jsonb)
      from public.duo_account_reservations h
      left join public.booster_profiles bp on bp.user_id = h.booster_id
      left join public.orders o on o.id = h.order_id
      where h.account_id = p_account_id
      order by h.reserved_at desc
      limit 50
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_duo_account_reservation_history(uuid) from public, anon;
grant execute on function public.get_duo_account_reservation_history(uuid) to authenticated;
