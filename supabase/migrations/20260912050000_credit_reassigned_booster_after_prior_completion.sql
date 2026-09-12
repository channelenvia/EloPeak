-- Bug: trg_fn_order_completed_booster_stats' idempotency guard (migration 136)
-- keys only on order_id ("not exists (select 1 from payout_records where
-- order_id = NEW.id)"). That correctly stops the SAME booster being credited
-- twice when an admin oscillates completed -> disputed -> completed on one
-- order (the case 136 was written for). But it also blocks crediting a
-- DIFFERENT booster entirely: a completed order can be refunded/charged back
-- (process_mp_payment_event moves it to refunded/disputed), an admin can
-- reopen it via admin_override_order_status, then hand it to a new booster
-- via admin_reassign_booster (apply_order_drop already accepts any active
-- status). When that second booster completes the order, payout_records
-- already has a row for this order_id (from the first booster), so the guard
-- silently skips crediting -- the second booster does real work for free.
--
-- Fix: scope the guard to (order_id, booster_id) using the column that's
-- already on payout_records, so re-crediting the same booster on the same
-- order still can't happen, but a genuinely different booster on the same
-- order can be paid.
--
-- Second, unrelated fix bundled in the same function: the is_top3 read here
-- had no `for update`, unlike the equivalent read in apply_order_drop. The
-- biweekly top3 recalculation job (refresh_top3_boosters) does a bulk UPDATE
-- on booster_profiles; without locking the row, an order completing in that
-- same instant can read a stale is_top3 and lock in the wrong commission
-- rate (40% vs 45%) for the whole order. Matches the locking discipline
-- apply_order_drop already uses.
create or replace function public.trg_fn_order_completed_booster_stats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_commission_rate   numeric(5,4);
  v_commission_amount numeric(10,2);
  v_net_amount        numeric(10,2);
  v_is_top3           boolean;
  v_payout_record_id  uuid;
begin
  if NEW.status = 'completed'
     and OLD.status is distinct from 'completed'
     and NEW.assigned_booster_id is not null
     and not exists (
       select 1 from public.payout_records
       where order_id = NEW.id and booster_id = NEW.assigned_booster_id
     )
  then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles
      where user_id = NEW.assigned_booster_id
      for update;

    v_commission_rate := case
      when NEW.service_type = 'coaching' then 0.30
      when v_is_top3 then 0.40
      else 0.45
    end;
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
