-- Revisão de segurança encontrou um IDOR remanescente em
-- update_duo_account_rank (migration 075): a correção anterior liberava a
-- escrita pra QUALQUER booster aprovado sempre que a conta estivesse livre
-- (reserved_by is null) -- que é o estado da MAIORIA das contas do pool na
-- maior parte do tempo. Ou seja, qualquer booster podia chamar a RPC direto
-- (sem passar pela UI) com o id de uma conta duo que NUNCA usou e sobrescrever
-- o rank dela com valores arbitrários, corrompendo o pool compartilhado
-- (public.duo_account_rank_is_valid() depende desse campo pra decidir se a
-- conta aparece como elegível em list_duo_accounts/reserve_duo_account).
--
-- O caso de uso legítimo (useDuoAccountAutoRefresh, ver
-- src/api/duoAccounts/hooks.ts) só precisa reescrever o rank de uma conta que
-- o PRÓPRIO booster acabou de liberar, pra manter o pool atualizado sem
-- depender de admin. Pra cobrir isso sem abrir a escrita ao pool inteiro,
-- registramos quem foi o último booster a segurar a reserva (last_released_by
-- / last_released_at) em todo caminho que libera uma conta, e
-- update_duo_account_rank só aceita reserved_by is null quando o chamador foi
-- quem liberou a conta há pouco (janela de 2 minutos -- a lista do booster
-- reconsulta a cada 15s, então é folga de sobra pro fluxo real, sem deixar a
-- janela de exploração aberta por muito tempo).

alter table public.duo_accounts
  add column if not exists last_released_by uuid references public.booster_profiles(user_id),
  add column if not exists last_released_at timestamptz;

-- ─── reserve_duo_account: ao trocar de conta, registra quem estava com a anterior ─

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

  select id, assigned_booster_id, boost_mode, status into v_order
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

  if v_previous_account_id is not null then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = auth.uid(), last_released_at = now()
    where id = v_previous_account_id;

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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'duo_account.reserved', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', false);
end;
$$;

-- ─── release_duo_account_reservation: registra quem estava com a reserva ────

create or replace function public.release_duo_account_reservation(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id into v_order from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null,
      last_released_by = reserved_by, last_released_at = now()
  where reserved_order_id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── admin_release_duo_account: idem ─────────────────────────────────────────

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

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'duo_account.admin_released', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- ─── trigger de liberação automática ao fim do pedido: idem ─────────────────

create or replace function public.trg_fn_release_duo_account_on_order_end()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('completed', 'canceled', 'refunded') and old.status is distinct from new.status then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = reserved_by, last_released_at = now()
    where reserved_order_id = new.id;
  end if;
  return new;
end;
$$;

-- ─── update_duo_account_rank: autorização real, sem IDOR ────────────────────

create or replace function public.update_duo_account_rank(
  p_account_id uuid,
  p_tier       text,
  p_division   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_account record;
begin
  if p_tier not in ('iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_tier');
  end if;
  if p_division is not null and p_division not in ('I','II','III','IV') then
    return jsonb_build_object('success', false, 'error', 'invalid_division');
  end if;

  select id, reserved_by, last_released_by, last_released_at
  into v_account
  from public.duo_accounts
  where id = p_account_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  if not (
    public.is_admin()
    or v_account.reserved_by = auth.uid()
    or (
      v_account.reserved_by is null
      and v_account.last_released_by = auth.uid()
      and v_account.last_released_at > now() - interval '2 minutes'
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division),
      updated_at = now()
  where id = p_account_id;

  return jsonb_build_object('success', true);
end;
$$;
