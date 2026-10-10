begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

-- pedido win_boost PAGO (payment paid -> amount_paid); status e booster configuraveis
create function pg_temp.mk(p_unit numeric, p_buy int, p_status public.order_status, p_booster uuid, p_w int, p_l int) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, wins_played, losses_played,
         match_sync_started_at, last_match_synced_at, mp_payment_id)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', p_unit * p_buy, p_unit * p_buy, 'win_boost', 'solo',
          '{"tier":"gold","division":"IV"}', p_buy, 3, p_status, 'paid', p_booster, p_w, p_l, now(), now(), 'mp-' || gen_random_uuid())
  returning id into v;
  insert into public.payments (order_id, customer_id, mp_payment_id, amount, currency, status)
  select v, '00000000-0000-0000-0000-0000000000c1', mp_payment_id, p_unit * p_buy, 'brl', 'paid' from public.orders where id = v;
  if p_booster is not null then
    insert into public.order_booster_assignments (order_id, booster_id) values (v, p_booster);
  end if;
  return v;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');

-- ---------- H-15: amount_paid acompanha o pagamento ----------
create temp table a on commit drop as select pg_temp.mk(5.67, 3, 'awaiting_assignment', null, 0, 0) as id;
select is((select amount_paid from public.orders where id = (select id from a)), 17.01, 'amount_paid vem do pagamento pago');

-- ---------- pedido NAO atribuido: analise -> reembolso total ----------
select is((public.admin_create_manual_refund((select id from a), 'cliente desistiu do pedido')->>'error'), 'order_not_under_review', 'reembolso exige o pedido marcado em analise antes');
select is((public.admin_flag_order_under_review((select id from a), 'cliente pediu cancelamento no chat')->>'success')::boolean, true, 'pedido no pool pode ser marcado em analise');
create temp table ar on commit drop as select public.admin_create_manual_refund((select id from a), 'cliente desistiu do pedido') as r;
select is((select (r->>'refund_amount')::numeric from ar), 17.01, 'sem booster: reembolso = valor pago inteiro');
select is((select (r->>'booster_credit')::numeric from ar), 0::numeric, 'sem booster: nada para creditar');
select is((public.admin_create_manual_refund((select id from a), 'segunda tentativa de reembolso')->>'error'), 'nothing_to_refund', 'nao existe segundo reembolso: o valor ja esta reservado');
select is((public.admin_confirm_manual_refund((select (r->>'refund_id')::uuid from ar))->>'success')::boolean, true, 'admin confirma o reembolso');
select is((select status::text from public.orders where id = (select id from a)), 'refunded', 'pedido reembolsado');
select is((select status::text from public.payments where order_id = (select id from a)), 'refunded', 'pagamento marcado refunded');
select is((select payment_status::text from public.orders where id = (select id from a)), 'refunded', 'orders.payment_status acompanha');
select ok((select sum(amount) from public.refunds where order_id = (select id from a)) <= (select amount_paid from public.orders where id = (select id from a)), 'reembolsos nunca passam do valor pago');

-- ---------- pedido ATRIBUIDO em andamento (2V/0D de 3): booster recebe o progresso, cliente o restante ----------
create temp table b on commit drop as select pg_temp.mk(5.67, 3, 'in_progress', '00000000-0000-0000-0000-0000000000b1', 2, 0) as id;
select is((public.order_settlement_preview((select id from b))->>'refund_amount')::numeric, 5.67, 'preview: reembolso = o que faltava (1 de 3 vitorias)');
select is((public.order_settlement_preview((select id from b))->>'booster_credit')::numeric, 6.24, 'preview: booster = 11,34 x 55%');
select public.admin_flag_order_under_review((select id from b), 'cliente quer cancelar o pedido em andamento');
create temp table br on commit drop as select public.admin_create_manual_refund((select id from b), 'cancelamento solicitado pelo cliente') as r;
select is((select (r->>'progress_pct')::numeric from br), 66.67, 'progresso 66,67%');
select is((select (r->>'booster_credit')::numeric + (r->>'refund_amount')::numeric + (r->>'platform_retained')::numeric from br), 17.01, 'credito + reembolso + retido = valor pago');
select is((select amount from public.booster_ledger_entries where order_id = (select id from b) and entry_type = 'commission_credit'), 6.24, 'booster recebe pelo progresso no ledger');
select is((select assigned_booster_id from public.orders where id = (select id from b)), null::uuid, 'atribuicao encerrada');
select is((select count(*)::int from public.order_booster_assignments where order_id = (select id from b) and unassigned_at is null), 0, 'historico de atribuicao fechado');
select is((select amount from public.refunds where order_id = (select id from b)), 5.67, 'refund pendente = valor calculado');
select is((public.admin_confirm_manual_refund((select (r->>'refund_id')::uuid from br))->>'success')::boolean, true, 'confirma reembolso parcial');
select is((select status::text from public.payments where order_id = (select id from b)), 'partially_refunded', 'pagamento parcialmente reembolsado');

-- ---------- progresso negativo (1V/3D): nada ao booster, reembolso total ----------
create temp table c on commit drop as select pg_temp.mk(5.67, 3, 'in_progress', '00000000-0000-0000-0000-0000000000b1', 1, 3) as id;
select public.admin_flag_order_under_review((select id from c), 'cancelamento com progresso negativo');
create temp table cr on commit drop as select public.admin_create_manual_refund((select id from c), 'cancelamento com progresso negativo') as r;
select is((select (r->>'booster_credit')::numeric from cr), 0::numeric, 'progresso negativo: booster nao recebe');
select is((select (r->>'refund_amount')::numeric from cr), 17.01, 'progresso negativo: reembolso total');
select is((select count(*)::int from public.booster_ledger_entries where order_id = (select id from c)), 0, 'progresso negativo: sem penalidade no cancelamento');

-- ---------- depois de DROP positivo: cliente so recebe o que sobrou ----------
create temp table d on commit drop as select pg_temp.mk(5.67, 5, 'drop_requested', '00000000-0000-0000-0000-0000000000b1', 3, 0) as id;
select public.apply_order_drop((select id from d), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'drop positivo', 'admin');
select public.admin_flag_order_under_review((select id from d), 'cancelar depois do drop positivo');
select is((public.admin_create_manual_refund((select id from d), 'cancelar depois do drop positivo')->>'refund_amount')::numeric, 11.34, 'apos drop positivo: reembolso = valor pago (28,35) - consumido (17,01)');

-- ---------- depois de DROP negativo + novo booster: reembolso nunca passa do pago ----------
create temp table e on commit drop as select pg_temp.mk(5.67, 5, 'drop_requested', '00000000-0000-0000-0000-0000000000b1', 1, 3) as id;
select public.apply_order_drop((select id from e), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'drop negativo', 'customer');
update public.orders set status = 'in_progress', assigned_booster_id = '00000000-0000-0000-0000-0000000000b2', wins_played = 2, losses_played = 0 where id = (select id from e);
insert into public.order_booster_assignments (order_id, booster_id) values ((select id from e), '00000000-0000-0000-0000-0000000000b2');
select public.admin_flag_order_under_review((select id from e), 'cancelar depois do drop negativo');
create temp table er on commit drop as select public.admin_create_manual_refund((select id from e), 'cancelar depois do drop negativo') as r;
select is((select (r->>'refund_amount')::numeric from er), 17.01, 'apos drop negativo: reembolso = pago (28,35) - 2 de 7 do preco novo (39,69)');
select ok((select (r->>'refund_amount')::numeric from er) <= 28.35, 'reembolso <= valor pago');
select is((select (r->>'booster_credit')::numeric from er), 6.24, 'proximo booster recebe pelo progresso no preco vigente');

-- ---------- drop NEGATIVO de elo com progresso: valor consumido sai do reembolso (H2) ----------
create temp table g2 on commit drop as select pg_temp.mk(10, 1, 'drop_requested', '00000000-0000-0000-0000-0000000000b1', 0, 2) as id;
update public.orders set service_type = 'elo_boost', wins_purchased = null, win_package = null, queue_type = 'solo_duo',
       current_rank = '{"tier":"gold","division":"IV"}', target_rank = '{"tier":"emerald","division":"IV"}',
       base_price = 215.20, total_price = 215.20 where id = (select id from g2);
update public.payments set amount = 215.20 where order_id = (select id from g2);
insert into public.order_rank_verifications (order_id, requested_by, riot_id_checked, target_tier, passed, fetched_tier, fetched_division, fetched_lp)
  values ((select id from g2), '00000000-0000-0000-0000-0000000000c1', 'x#br1', 'emerald', false, 'platinum', 'IV', 50);
select public.apply_order_drop((select id from g2), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'drop negativo elo', 'customer');
select is((select settled_value from public.orders where id = (select id from g2)), 103.55, 'drop negativo com progresso: valor consumido fica registrado');
-- H1: o proximo booster comeca do zero, sem herdar a verificacao do anterior
update public.orders set status = 'in_progress', assigned_booster_id = '00000000-0000-0000-0000-0000000000b2' where id = (select id from g2);
insert into public.order_booster_assignments (order_id, booster_id, assigned_at) values ((select id from g2), '00000000-0000-0000-0000-0000000000b2', now() + interval '1 minute');
select is((public._order_progress_fraction((select id from g2))), 0::numeric, 'novo booster nao herda o progresso verificado do anterior');
select public.admin_flag_order_under_review((select id from g2), 'cancelar depois do drop negativo de elo');
select is((public.order_settlement_preview((select id from g2))->>'remaining')::numeric, 111.65, 'remaining = pago (215,20) - consumido (103,55)');

-- M2 / L1: Clash apos drop positivo e pedido sem wins_purchased
create temp table cl on commit drop as select pg_temp.mk(10, 1, 'in_progress', '00000000-0000-0000-0000-0000000000b1', 1, 0) as id;
update public.orders set service_type = 'clash', wins_purchased = null, win_package = null, current_rank = null,
       clash_tier = 'tier_2', clash_day = 'saturday', settled_value = 6.67, amount_paid = 10, base_price = 3.33, total_price = 3.33 where id = (select id from cl);
select is(public._order_progress_fraction((select id from cl)), 1.0000000000000000::numeric, 'clash: apos 2 de 3 partidas ja pagas, 1 partida restante = 100%');
update public.orders set service_type = 'win_boost', wins_purchased = null, clash_tier = null, clash_day = null,
       current_rank = '{"tier":"gold","division":"IV"}' where id = (select id from cl);
select is(public._order_progress_fraction((select id from cl)), 0::numeric, 'win_boost sem wins_purchased: progresso 0 (nao credita de graca)');

-- ---------- cancelar: o pago nao consumido volta ao cliente (nunca fica retido) ----------
create temp table f on commit drop as select pg_temp.mk(5.67, 3, 'awaiting_assignment', null, 0, 0) as id;
select public.admin_flag_order_under_review((select id from f), 'cancelar pedido ainda no pool');
create temp table fr on commit drop as select public.admin_cancel_paid_order((select id from f), 'cancelar pedido ainda no pool') as r;
select is((select status::text from public.orders where id = (select id from f)), 'canceled', 'pedido cancelado');
select is((select amount from public.refunds where order_id = (select id from f)), 17.01, 'cancelar tambem gera o reembolso do valor pago nao consumido');
select is((public.admin_confirm_manual_refund((select (r->>'refund_id')::uuid from fr))->>'success')::boolean, true, 'confirma o reembolso do pedido cancelado');
select is((select status::text from public.orders where id = (select id from f)), 'canceled', 'pedido cancelado continua cancelado apos o reembolso');
select is((select payment_status::text from public.orders where id = (select id from f)), 'refunded', '...com pagamento reembolsado');

-- cancelar pedido em analise (botao antigo) tambem paga o booster pelo progresso
create temp table k on commit drop as select pg_temp.mk(5.67, 3, 'in_progress', '00000000-0000-0000-0000-0000000000b1', 2, 0) as id;
select public.admin_flag_order_under_review((select id from k), 'cancelar pelo botao antigo de analise');
select is((public.admin_cancel_pending_review_order((select id from k), 'cancelar pelo botao antigo de analise')->>'success')::boolean, true, 'cancelar pedido em analise funciona');
select is((select amount from public.booster_ledger_entries where order_id = (select id from k) and entry_type = 'commission_credit'), 6.24, 'cancelar em analise credita o booster pelo progresso');

-- 3o drop pelo admin + liquidacao manual: booster recebe pelo progresso e cliente o restante
create temp table t3 on commit drop as select pg_temp.mk(5.67, 3, 'drop_requested', '00000000-0000-0000-0000-0000000000b1', 2, 0) as id;
update public.orders set drop_count = 2 where id = (select id from t3);
select public.apply_order_drop((select id from t3), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', '3o drop pelo admin', 'admin');
select is((select status::text from public.orders where id = (select id from t3)), 'under_review', '3o drop: em analise');
create temp table t3r on commit drop as select public.admin_create_manual_refund((select id from t3), 'liquidacao manual do 3o drop') as r;
select is((select (r->>'booster_credit')::numeric from t3r), 6.24, '3o drop: booster recebe pelo progresso (2 de 3)');
select is((select (r->>'refund_amount')::numeric from t3r), 5.67, '3o drop: cliente recebe o restante');

-- ---------- permissao ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.admin_create_manual_refund((select id from d), 'cliente tentando se reembolsar')->>'error'), 'unauthorized', 'cliente nao reembolsa');
select is((public.order_settlement_preview((select id from d))->>'success')::boolean, true, 'cliente ve o preview do proprio pedido');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is((public.order_settlement_preview((select id from a))->>'success')::boolean, false, 'booster nao ve pedido alheio');

-- ---------- webhook: reembolso grava o valor PAGO, nao o total_price reescrito ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
reset role;
create temp table w on commit drop as select pg_temp.mk(5.67, 3, 'completed', '00000000-0000-0000-0000-0000000000b1', 3, 0) as id;
update public.orders set total_price = 40, base_price = 40 where id = (select id from w);
insert into public.booster_ledger_entries (booster_id, order_id, entry_type, amount, description) values
  ('00000000-0000-0000-0000-0000000000b1', (select id from w), 'commission_credit', 9.36, 'x');
select public.process_mp_payment_event((select id from w), (select mp_payment_id from public.orders where id = (select id from w)), 'refunded', 17.01, 'brl', 'evt-1');
select is((select amount from public.refunds where order_id = (select id from w)), 17.01, 'webhook: refund = valor pago (nao o total_price 40)');
select is((select amount from public.booster_ledger_entries where order_id = (select id from w) and entry_type = 'refund_debit'), -9.36, 'comissao estornada apos reembolso do provedor');
select is((public.process_mp_payment_event((select id from w), (select mp_payment_id from public.orders where id = (select id from w)), 'pending', 17.01, 'brl', 'evt-2')->>'success')::boolean, true, 'evento obsoleto e aceito...');
select is((select status::text from public.payments where order_id = (select id from w)), 'refunded', '...mas nao rebaixa o pagamento reembolsado');

-- ---------- H-09 / H-10 / H-11 ----------
create temp table g on commit drop as select pg_temp.mk(5.67, 3, 'canceled', null, 0, 0) as id;
select throws_ok(format($$select public.record_pix_payment(%L, '00000000-0000-0000-0000-0000000000c1', 'mp-x', 17.01)$$, (select id from g)),
  'P0001', 'order not payable', 'nao registra cobranca em pedido cancelado');

-- H-10: pagamento aprovado depois do cancelamento reabre o pedido
create temp table h on commit drop as select pg_temp.mk(5.67, 3, 'canceled', null, 0, 0) as id;
update public.orders set payment_status = 'pending' where id = (select id from h);
update public.payments set status = 'pending' where order_id = (select id from h);
select public.process_mp_payment_event((select id from h), (select mp_payment_id from public.orders where id = (select id from h)), 'approved', 17.01, 'brl', 'evt-3');
select is((select status::text from public.orders where id = (select id from h)), 'awaiting_customer', 'aprovado apos cancelamento: pedido reaberto e pago');
select is((select payment_status::text from public.orders where id = (select id from h)), 'paid', '...com payment_status paid');

-- H-11 / H-10: expiracao
insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, created_at)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_payment', now() - interval '25 hours');
create temp table px on commit drop as select pg_temp.mk(5.67, 3, 'awaiting_payment', null, 0, 0) as id;
update public.orders set payment_status = 'pending' where id = (select id from px);
update public.payments set status = 'pending', created_at = now() - interval '40 minutes' where order_id = (select id from px);
select public.expire_stale_pix_orders();
select is((select count(*)::int from public.orders where status = 'awaiting_payment' and created_at < now() - interval '24 hours'), 0, 'pedido salvo e nunca pago expira em 24 h');
select is((select status::text from public.orders where id = (select id from px)), 'canceled', 'PIX vencido cancela o pedido');
select is((select status::text from public.payments where order_id = (select id from px)), 'failed', '...e marca o pagamento como failed');

-- ---------- janela de saque (RN-10) ----------
select ok(public.is_payout_window_day('2027-01-15 15:00+00') and public.is_payout_window_day('2027-01-31 15:00+00')
      and public.is_payout_window_day('2027-02-28 15:00+00') and public.is_payout_window_day('2028-02-29 15:00+00')
      and not public.is_payout_window_day('2027-01-30 15:00+00') and not public.is_payout_window_day('2027-02-14 15:00+00'),
  'saque: dia 15 e ultimo dia do mes (fevereiro e 31 incluidos)');

select * from finish();
rollback;
