-- Coaching sempre paga 70% do valor pro booster (30% de comissão da
-- plataforma), diferente do split normal/top3 (55%/60%, ou seja, comissão de
-- 45%/40%) usado pelos outros service_types -- valor fixo, não varia com
-- is_top3.
--
-- Só o trigger de CONCLUSÃO (trg_fn_order_completed_booster_stats) precisa
-- da correção. O caminho de drop (apply_order_drop/request_order_drop/
-- request_customer_order_drop, migrations 135/20260815050000) usa o mesmo
-- 0.55/0.60 pra calcular pagamento proporcional, mas order_drop_completion_pct
-- (migration 116) já retorna 0 pra coaching ("sem progresso gradual") -- o
-- payout de drop de coaching é sempre total_price * share_pct * 0 = 0,
-- então a % ali já é inerte pra coaching independente do valor. Não vale o
-- risco de reescrever aquela função (272 linhas, penalidades/advertências)
-- por uma mudança sem efeito prático nenhum.
--
-- Corpo idêntico à versão anterior (migrations_archive/136), só a linha de
-- v_commission_rate ganha o branch de coaching.
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
       select 1 from public.payout_records where order_id = NEW.id
     )
  then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles
      where user_id = NEW.assigned_booster_id;

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
