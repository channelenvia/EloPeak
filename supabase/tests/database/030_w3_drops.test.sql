begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------- fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

-- pedido win_boost em andamento: p_unit por vitoria, p_buy vitorias compradas, p_w/p_l contadores
create function pg_temp.mk_win(p_unit numeric, p_buy int, p_w int, p_l int, p_drops int default 0) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, wins_played, losses_played, drop_count,
         match_sync_started_at, last_match_synced_at)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', p_unit * p_buy, p_unit * p_buy, 'win_boost', 'solo',
          '{"tier":"gold","division":"IV"}', p_buy, 3, 'drop_requested', 'paid', '00000000-0000-0000-0000-0000000000b1', p_w, p_l, p_drops, now(), now())
  returning id into v;
  insert into public.order_booster_assignments (order_id, booster_id) values (v, '00000000-0000-0000-0000-0000000000b1');
  return v;
end $$;

create function pg_temp.drop_it(p_order uuid, p_role public.drop_requester_role default 'admin') returns jsonb language sql as $$
  select public.apply_order_drop(p_order, 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'teste de drop', p_role)
$$;

-- ---------- RN-06: drop positivo (3V/0D de 5, gold solo 5,67) ----------
create temp table pos on commit drop as select pg_temp.mk_win(5.67, 5, 3, 0) as id;
create temp table pos_r on commit drop as select pg_temp.drop_it((select id from pos)) as r;
select is((select (r->>'payout_amount')::numeric from pos_r), 9.36, 'positivo: booster recebe a parte do progresso (3 x 5,67 x 0,55)');
select is((select total_price from public.orders where id = (select id from pos)), 11.34, 'positivo: pedido volta repreciado pelo restante (2 vitorias)');
select is((select wins_purchased from public.orders where id = (select id from pos)), 2, 'positivo: restam 2 vitorias');
select is((select status::text from public.orders where id = (select id from pos)), 'awaiting_assignment', 'positivo: volta ao pool');
select is((select settled_value from public.orders where id = (select id from pos)), 17.01, 'positivo: valor bruto consumido fica registrado');
select is((select amount from public.booster_ledger_entries where order_id = (select id from pos) and entry_type = 'commission_credit'), 9.36, 'positivo: credito no ledger');
select is((select wins_played + losses_played from public.orders where id = (select id from pos)), 0, 'contadores zerados para o proximo booster');

-- ---------- empate nao paga nem penaliza ----------
create temp table tie on commit drop as select pg_temp.mk_win(5.67, 3, 3, 3) as id;
create temp table tie_r on commit drop as select pg_temp.drop_it((select id from tie)) as r;
select is((select (r->>'payout_amount')::numeric from tie_r), 0::numeric, 'empate 3V/3D: sem payout');
select is((select (r->>'penalty_amount')::numeric from tie_r), 0::numeric, 'empate 3V/3D: sem penalidade');
select is((select total_price from public.orders where id = (select id from tie)), 17.01, 'empate: pedido volta com o mesmo preco (3 vitorias)');

-- ---------- RN-07: negativo, penalidade igual para booster, cliente e admin ----------
create temp table neg on commit drop as select
  pg_temp.mk_win(5.67, 5, 1, 3) as b, pg_temp.mk_win(5.67, 5, 1, 3) as c, pg_temp.mk_win(5.67, 5, 1, 3) as a;
create temp table neg_r on commit drop as select
  pg_temp.drop_it((select b from neg), 'booster') as b, pg_temp.drop_it((select c from neg), 'customer') as c, pg_temp.drop_it((select a from neg), 'admin') as a;
select is((select (b->>'penalty_amount')::numeric from neg_r), 17.01, 'negativo 1V/3D: penalidade = 3 x 5,67 (booster pediu)');
select is((select (c->>'penalty_amount')::numeric from neg_r), 17.01, 'negativo: mesma penalidade quando o cliente pede');
select is((select (a->>'penalty_amount')::numeric from neg_r), 17.01, 'negativo: mesma penalidade quando o admin pede');
select is((select total_price from public.orders where id = (select b from neg)), 39.69, 'negativo: pedido volta com 7 vitorias (5-1+3) a 5,67');
select is((select sum(amount) from public.booster_ledger_entries where order_id = (select c from neg) and entry_type = 'drop_penalty'), -17.01, 'negativo: penalidade sai da carteira do booster anterior');
select is((select count(*)::int from public.booster_ledger_entries where order_id = (select c from neg) and booster_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'negativo: cliente nao tem lancamento');
select is((select settled_value from public.orders where id = (select b from neg)), 0::numeric, 'negativo: nada foi consumido');

-- ---------- tudo entregue: conclui em vez de reabrir ----------
create temp table done on commit drop as select pg_temp.mk_win(5.67, 3, 3, 0) as id;
create temp table done_r on commit drop as select pg_temp.drop_it((select id from done)) as r;
select is((select status::text from public.orders where id = (select id from done)), 'completed', 'objetivo ja entregue: conclui, nao reabre com preco 0');
select is((select count(*)::int from public.payout_records where order_id = (select id from done)), 1, 'conclusao gera um payout');

-- ---------- 3o drop: so o admin; pedido vai para analise COM o booster para liquidacao manual ----------
create temp table lim on commit drop as select pg_temp.mk_win(5.67, 5, 2, 0, 2) as id;
create temp table lim_r on commit drop as select pg_temp.drop_it((select id from lim)) as r;
select is((select status::text from public.orders where id = (select id from lim)), 'under_review', '3o drop (admin): pedido vai para analise manual');
select is((select assigned_booster_id from public.orders where id = (select id from lim)), '00000000-0000-0000-0000-0000000000b1'::uuid, '3o drop: o booster continua vinculado (para receber pelo progresso)');
select is((select wins_played from public.orders where id = (select id from lim)), 2, '3o drop: progresso preservado');
select is((select count(*)::int from public.booster_ledger_entries where order_id = (select id from lim)), 0, '3o drop: nada e pago nem penalizado automaticamente (o admin acerta na liquidacao)');

-- booster e cliente NAO conseguem pedir o 3o drop
create temp table req on commit drop as select pg_temp.mk_win(5.67, 5, 2, 0, 2) as b;
update public.orders set status = 'in_progress' where id = (select b from req);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((public.request_order_drop((select b from req), 'preciso largar o pedido')->>'error'), 'drop_limit_reached', 'booster nao pede o 3o drop');
create temp table reqc on commit drop as select pg_temp.mk_win(5.67, 5, 2, 0, 2) as c;
update public.orders set status = 'in_progress' where id = (select c from reqc);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.request_customer_order_drop((select c from reqc), 'quero trocar de booster')->>'error'), 'drop_limit_reached', 'cliente nao pede o 3o drop');

-- ---------- progresso: Clash (3 partidas), Elo ponderado ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table clash on commit drop as select pg_temp.mk_win(10, 1, 1, 1) as id;
update public.orders set service_type = 'clash', wins_purchased = null, win_package = null, current_rank = null,
       clash_tier = 'tier_2', clash_day = 'saturday' where id = (select id from clash);
select is(round(public._order_progress_fraction((select id from clash)), 4), 0.6667, 'clash: 2 de 3 partidas = 66,67%');

create temp table elo on commit drop as select pg_temp.mk_win(10, 1, 0, 0) as id;
update public.orders set service_type = 'elo_boost', wins_purchased = null, win_package = null, queue_type = 'solo_duo',
       current_rank = '{"tier":"gold","division":"IV"}', target_rank = '{"tier":"emerald","division":"IV"}',
       base_price = 215.20, total_price = 215.20 where id = (select id from elo);
insert into public.order_rank_verifications (order_id, requested_by, riot_id_checked, target_tier, passed, fetched_tier, fetched_division, fetched_lp)
  values ((select id from elo), '00000000-0000-0000-0000-0000000000c1', 'x#br1', 'emerald', false, 'platinum', 'IV', 50);
select is(round(public._order_progress_fraction((select id from elo)), 4), 0.4812, 'elo: Gold IV>Emerald IV em Platinum IV 50 LP = 48,1% (degraus ponderados, nao linear)');
select ok(public._order_progress_fraction((select id from elo)) > 0.25 and public._order_progress_fraction((select id from elo)) < 0.5, 'elo ponderado difere do linear');

select is(public.compute_drop_penalty('customer', 5.67, 3.12, 3), public.compute_drop_penalty('booster', 5.67, 3.12, 3), 'penalidade independe de quem pediu');
select ok(not has_function_privilege('authenticated', 'public.apply_order_drop(uuid,text,uuid,text,public.drop_requester_role,numeric)', 'EXECUTE'), 'apply_order_drop segue interno');

select * from finish();
rollback;
