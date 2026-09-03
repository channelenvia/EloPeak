-- Fix de migration 118: order_status_history.from_status é public.order_status
-- (enum), mas apply_order_drop recebe p_from_status text -- mesma classe de
-- erro do fix da migration 117 (Postgres não faz cast implícito de text pra
-- enum num INSERT). Único ajuste: p_from_status::public.order_status.

create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order            record;
  v_completion_pct   numeric;
  v_is_top3          boolean;
  v_share_pct        numeric;
  v_payout           numeric;
  v_latest           record;
  v_new_current_rank jsonb;
  v_new_total_price  numeric;
  v_price_halved     boolean;
begin
  select id, service_type, total_price, current_rank, customer_id, assigned_booster_id
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  if v_completion_pct >= 50 then
    v_payout          := round(v_order.total_price * v_share_pct * 0.5, 2);
    v_new_total_price := round(v_order.total_price * 0.5, 2);
    v_price_halved    := true;
  else
    v_payout          := 0;
    v_new_total_price := v_order.total_price;
    v_price_halved    := false;
  end if;

  v_new_current_rank := v_order.current_rank;
  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null then
    select fetched_tier, fetched_division into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;
    if v_latest.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest.fetched_tier, 'division', v_latest.fetched_division);
    end if;
  end if;

  update public.orders set
    status               = 'awaiting_assignment',
    assigned_booster_id  = null,
    preferred_booster_id = null,
    exclusive_until      = null,
    used_exclusive_slot  = false,
    total_price          = v_new_total_price,
    base_price           = case when v_price_halved then v_new_total_price else base_price end,
    extras_price          = case when v_price_halved then 0 else extras_price end,
    discount_price        = case when v_price_halved then 0 else discount_price end,
    current_rank         = v_new_current_rank,
    updated_at           = now()
  where id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles
    set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial (' || round(v_completion_pct) || '% concluído) pelo pedido '
        || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'Você concluiu ' || round(v_completion_pct) || '% do pedido antes do drop -- R$ '
        || v_payout::text || ' foi creditado ao seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout, 'completion_pct', v_completion_pct)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('completion_pct', v_completion_pct, 'payout_amount', v_payout);
end;
$$;
