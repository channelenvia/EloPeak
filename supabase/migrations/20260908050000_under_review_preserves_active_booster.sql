-- Pedido do admin: "Analisar" sobre um pedido ATIVO (com booster atribuído)
-- reusava apply_order_drop -- ou seja, desatribuía o booster, pagava/
-- penalizava ele proporcionalmente ao progresso (a mesma fórmula de um drop
-- de verdade), zerava wins_played/losses_played/match_sync_started_at e
-- recalculava total_price/estimated_hours. Isso nunca foi "só travar o
-- pedido": o booster mudava, o valor do pedido mudava, e o cliente recebia
-- a notificação (dentro do próprio apply_order_drop) de que o pedido
-- "voltou pra fila -- já disponível para outro booster assumir", que é
-- falsa (na sequência o status é sobrescrito pra under_review, travado).
--
-- Fix: "Analisar" sobre pedido ativo agora só troca o status pra
-- under_review, preservando assigned_booster_id/preferred_booster_id/
-- total_price/wins_played/losses_played/match_sync_started_at intactos --
-- sem tocar em apply_order_drop, sem payout, sem penalidade. O pagamento
-- proporcional ao progresso continua existindo só onde já fazia sentido:
-- drop de verdade (apply_order_drop direto) e reatribuição
-- (admin_reassign_booster), ambos inalterados aqui.
--
-- Contagem de partidas e acesso a credenciais/token da conta já ficam
-- bloqueados de graça nesse caso: cron-sync-order-matches e o polling do
-- booster só rodam pra status in_progress/paused/drop_requested, e
-- get_order_credentials/duo account access só liberam pra um allowlist de
-- status que não inclui under_review -- nenhum dos dois checa
-- assigned_booster_id sozinho, então manter o booster atribuído não abre
-- brecha nenhuma.
--
-- under_review_from_status/under_review_started_at guardam o necessário
-- pra restaurar certo na liberação: o status anterior (pra voltar pro
-- mesmo lugar, não pro pool) e o instante em que travou (pra empurrar
-- match_sync_started_at pelo tempo parado, "pausando" o prazo de entrega
-- estimada em vez de deixá-lo correr durante a análise). Ficam null fora
-- desse caso específico (pending_review sem booster, ou under_review por
-- limite de 2 drops -- nesses dois assigned_booster_id já é null).
alter table public.orders
  add column if not exists under_review_from_status public.order_status,
  add column if not exists under_review_started_at timestamptz;

comment on column public.orders.under_review_from_status is
  'Status anterior de um pedido travado em análise mantendo o mesmo booster (Analisar sobre pedido ativo, sem apply_order_drop) -- usado por _release_pending_review_order pra restaurar o status certo ao liberar em vez de reabrir pro pool. Null fora desse caso.';
comment on column public.orders.under_review_started_at is
  'Quando a análise com booster preservado começou -- usado pra empurrar match_sync_started_at na liberação, "pausando" o prazo de entrega estimada pelo tempo que o pedido ficou travado. Null fora desse caso.';

-- ─── 1. Analisar: trava sem dropar quando há booster ativo ────────────────
create or replace function public.admin_flag_order_under_review(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_from_status public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_from_status := v_order.status;

  if v_order.assigned_booster_id is not null then
    update public.orders
    set status                    = 'under_review',
        under_review_from_status  = v_from_status,
        under_review_started_at   = now(),
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido entrou em análise manual da nossa equipe -- fica travado (sem novas partidas contabilizadas) até liberarmos de novo. Entraremos em contato pelo chat do pedido se precisarmos de mais informações.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido seu foi colocado em análise pela equipe -- sync de partidas e acesso à conta ficam pausados até liberarmos de novo. Você continua responsável por ele.',
      jsonb_build_object('order_id', p_order_id)
    );

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'from_status', v_from_status, 'booster_preserved', true));

    return jsonb_build_object('success', true);
  end if;

  update public.orders
  set status               = 'under_review',
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido em análise',
      'Seu pedido entrou em análise manual pela nossa equipe. Se precisarmos de mais informações, falaremos com você pelo chat do pedido.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'from_status', v_from_status));

  return jsonb_build_object('success', true);
end;
$$;

-- ─── 2. Liberação: restaura o status/booster anteriores quando preservados ─
create or replace function public._release_pending_review_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order            record;
  v_exclusive_until  timestamptz;
  v_restored_status  public.order_status;
begin
  select id, status, customer_id, preferred_booster_id, service_type,
         assigned_booster_id, under_review_from_status, under_review_started_at
  into v_order
  from public.orders
  where id = p_order_id and status in ('pending_review', 'under_review')
  for update;

  if not found then
    return;
  end if;

  -- Análise com booster preservado (Analisar sobre pedido ativo, sem
  -- apply_order_drop): restaura o status anterior mantendo o mesmo
  -- booster, e empurra match_sync_started_at pelo tempo que ficou travado
  -- -- "pausa" o prazo de entrega estimada em vez de deixá-lo correr
  -- durante a análise.
  if v_order.assigned_booster_id is not null then
    v_restored_status := coalesce(v_order.under_review_from_status, 'assigned'::public.order_status);

    update public.orders
    set status                    = v_restored_status,
        match_sync_started_at     = case
          when match_sync_started_at is not null and v_order.under_review_started_at is not null
            then match_sync_started_at + (now() - v_order.under_review_started_at)
          else match_sync_started_at
        end,
        under_review_from_status  = null,
        under_review_started_at   = null,
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_restored_status, coalesce(p_actor_id, v_order.customer_id), p_reason);

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido liberado',
      'O pedido que estava em análise foi liberado -- você pode continuar de onde parou.',
      jsonb_build_object('order_id', p_order_id)
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido liberado',
        'A análise do seu pedido foi concluída -- ele voltou a andar normalmente.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null and v_order.service_type <> 'coaching'
      then now() + interval '12 hours'
    else null
  end;

  update public.orders
  set status               = 'awaiting_assignment',
      exclusive_until      = v_exclusive_until,
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

  if v_order.preferred_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.preferred_booster_id, 'exclusive_job', 'Pedido exclusivo para você!',
      'Um pedido foi reservado pra você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;
end;
$$;

-- ─── 3. Cancelar a partir da revisão: libera o booster preservado, se houver ─
create or replace function public.admin_cancel_pending_review_order(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  update public.orders
  set status                    = 'canceled',
      assigned_booster_id       = null,
      preferred_booster_id      = case when v_order.assigned_booster_id is not null then null else preferred_booster_id end,
      exclusive_until           = case when v_order.assigned_booster_id is not null then null else exclusive_until end,
      used_exclusive_slot       = case when v_order.assigned_booster_id is not null then false else used_exclusive_slot end,
      under_review_from_status  = null,
      under_review_started_at   = null,
      admin_review_locked       = false,
      review_release_at         = null,
      updated_at                = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido cancelado',
      'Um pedido seu que estava em análise foi cancelado pela administração. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_canceled', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'had_assigned_booster', v_order.assigned_booster_id is not null));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido foi cancelado pela administração. Motivo: ' || v_reason
        || '. O reembolso será tratado manualmente pela nossa equipe.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── 4. Atribuir a partir da revisão: só quando não há booster já ativo ────
-- (pedido já vinculado a um booster preservado tem que ser trocado via
-- "Reatribuir" (admin_reassign_booster), que já paga/penaliza certo pelo
-- progresso -- essa RPC nunca soube fazer isso, sempre foi pro caso
-- "pending_review sem booster nenhum".)
create or replace function public.admin_assign_pending_review_order(p_order_id uuid, p_target_booster_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order  record;
  v_target record;
  v_reason text := coalesce(trim(p_reason), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, service_type, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;
  if v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_has_active_booster');
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set status                = 'awaiting_assignment',
      preferred_booster_id  = p_target_booster_id,
      exclusive_until       = case when v_order.service_type = 'coaching' then null else now() + interval '12 hours' end,
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at            = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, v_order.status, 'awaiting_assignment', auth.uid(),
    case when v_reason <> '' then 'Atribuído pelo admin: ' || v_reason else 'Atribuído pelo admin' end
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'exclusive_job', 'Pedido reservado para você!',
    'Um administrador reservou este pedido pra você. Você tem 12 horas para aceitar antes que ele volte para a fila geral.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_assigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'target_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;
