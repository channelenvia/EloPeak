-- Comissão do booster passa de 75% fixo (25% de plataforma) para:
--   Booster normal: 55% do valor do pedido (45% de comissão da plataforma)
--   Booster Top3:   60% do valor do pedido (40% de comissão da plataforma)
-- `commission_rate`/`commission_amount` em payout_records continuam
-- representando o valor retido pela plataforma (não o que o booster recebe)
-- -- mesma semântica já usada pela trigger original (migration 001).

create or replace function public.trg_fn_order_completed_booster_stats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_top3           boolean;
  v_commission_rate   numeric(5,4);
  v_commission_amount numeric(10,2);
  v_net_amount        numeric(10,2);
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
    );
  end if;
  return NEW;
end;
$$;

alter table public.payout_records
  alter column commission_rate set default 0.45;

comment on function public.trg_fn_order_completed_booster_stats is
  'Ao concluir um pedido, credita o net_amount ao booster e registra o '
  'payout_record. Comissão da plataforma: 45% (booster normal, recebe 55%) '
  'ou 40% (booster Top3, recebe 60%) -- ver booster_profiles.is_top3.';
