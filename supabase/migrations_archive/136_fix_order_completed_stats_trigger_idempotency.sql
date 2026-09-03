-- Achado na auditoria do painel admin: trg_fn_order_completed_booster_stats
-- (migration 081) credita comissão sempre que NEW.status = 'completed' e
-- OLD.status é diferente de 'completed' -- sem checar se este pedido JÁ foi
-- concluído antes. Isso é diretamente explorável pelo fluxo normal do admin:
-- em OrderDetail.tsx, FORWARD_STATUS['disputed'] oferece tanto "Reabrir
-- pedido" (-> in_progress) quanto "Confirmar conclusão" (-> completed), e
-- EXCEPTIONAL_STATUS_OPTIONS sempre oferece "Marcar como disputado" pra
-- qualquer pedido não-disputado. Um admin pode, através da própria UI
-- (sem precisar chamar a RPC manualmente), oscilar um pedido:
--   completed -> disputed -> completed -> disputed -> completed ...
-- cada transição PARA 'completed' passa por admin_override_order_status,
-- que só bloqueia a transição pra 'awaiting_assignment' (fix da migration
-- 131) -- todas as outras, incluindo repetir 'completed', são permitidas
-- sem validação de transição (intencional, é a "válvula de escape" do
-- admin). Cada vez que isso acontece, o trigger dispara de novo e:
--   1. insere uma NOVA linha em payout_records pro mesmo order_id
--   2. insere um NOVO commission_credit em booster_ledger_entries,
--      inflando o saldo sacável do booster (ele pode sacar 2x+ pelo mesmo
--      pedido)
--   3. incrementa booster_profiles.total_completed/total_earnings de novo
--   4. infla admin_dashboard_stats.total_payouts (soma payout_records.net_amount)
--      e, por consequência, platform_profit -- exatamente o double counting
--      que a auditoria pediu pra investigar.
--
-- Fix: idempotência explícita, no mesmo padrão já usado em
-- process_mp_payment_event (migration 131, checagem de webhook_event_id) --
-- só credita se ainda não existe payout_records pra este pedido.
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
