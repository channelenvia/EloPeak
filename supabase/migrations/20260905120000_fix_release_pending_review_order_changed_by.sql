-- Bug: release_pending_review_orders() (cron a cada 10s) chama
-- _release_pending_review_order(v_order_id, null, ...) -- o null ia direto
-- pra changed_by em order_status_history, que é NOT NULL. Toda liberação
-- automática falhava e dava rollback (incluindo o update de status pra
-- awaiting_assignment feito na mesma função/transação), então nenhum pedido
-- pago saía de pending_review sozinho: não caía no pool dos boosters nem
-- disparava o anúncio no Discord (ambos condicionados a status =
-- awaiting_assignment). Ver cron.job_run_details do job
-- release-pending-review-orders -- só liberação manual (admin_set_pending_
-- review_lock/admin_assign_pending_review_order, que sempre passam auth.uid())
-- funcionava.
--
-- Fix: quando p_actor_id é null (liberação automática do cron), usa
-- v_order.customer_id como changed_by -- mesma convenção já usada por outras
-- transições de status disparadas pelo sistema sem ator humano (ver
-- expire_stale_pix_orders, migration 048).
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
  v_order record;
  v_exclusive_until timestamptz;
begin
  select id, customer_id, preferred_booster_id
  into v_order
  from public.orders
  where id = p_order_id and status = 'pending_review'
  for update;

  if not found then
    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null then now() + interval '12 hours'
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
  values (p_order_id, 'pending_review', 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

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

revoke all on function public._release_pending_review_order(uuid, uuid, text) from public, anon, authenticated;
