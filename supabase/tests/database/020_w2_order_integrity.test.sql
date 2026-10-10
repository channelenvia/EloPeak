begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ---------- fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
update public.profiles set terms_accepted_at = now(), privacy_accepted_at = now(), legal_version = public.current_legal_version() where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.mk_order(p_status public.order_status, p_booster uuid default null, p_paid boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
                             current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo',
          '{"tier":"gold","division":"IV"}', 3, 3, p_status, case when p_paid then 'paid' else 'pending' end::public.payment_status, p_booster)
  returning id into v;
  return v;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ---------- C-05: cliente nao conclui pedido sem booster ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table o on commit drop as select
  pg_temp.mk_order('awaiting_customer') as nobooster,
  pg_temp.mk_order('awaiting_customer', '00000000-0000-0000-0000-0000000000b1') as withbooster;
select is((public.confirm_order_completion((select nobooster from o))->>'error'), 'no_booster_assigned',
  'confirmar pedido pago sem booster e recusado');
select is((public.get_customer_order_state((select nobooster from o))->>'can_confirm_completion')::boolean, false,
  'UI nao oferece confirmar sem booster');
select is((select status::text from public.orders where id = (select nobooster from o)), 'awaiting_customer', 'pedido sem booster segue aguardando');

-- ---------- confirmar com booster conclui e gera payout ----------
select is((public.confirm_order_completion((select withbooster from o))->>'success')::boolean, true, 'cliente confirma pedido com booster');
select is((select count(*)::int from public.payout_records where order_id = (select withbooster from o)), 1, 'conclusao gera payout');

-- ---------- H-05: reatribuido conclui e recebe ----------
select throws_ok($$update public.orders set status = 'in_progress' where id = (select withbooster from o)$$,
  '23514', null, 'pedido concluido nao pode ser reaberto (evita pagar duas vezes)');
select lives_ok($$insert into public.payout_records (booster_id, order_id, gross_amount, commission_rate, commission_amount, net_amount, status)
  values ('00000000-0000-0000-0000-0000000000b2', (select withbooster from o), 10, 0.45, 4.5, 5.5, 'pending')$$,
  'indice de payout permite um registro por booster no mesmo pedido');

-- ---------- H-03: booster nao aprovado nao aceita ----------
insert into public.booster_services (booster_id, title, description, tempo, price, lanes, specialties)
  values ('00000000-0000-0000-0000-0000000000b1', 'P', 'd', '1h', 50, array['mid'], array['macro']);
create temp table cp on commit drop as select pg_temp.mk_order('awaiting_assignment') as id;
update public.orders set service_type = 'coaching', preferred_booster_id = '00000000-0000-0000-0000-0000000000b1',
  booster_service_id = (select id from public.booster_services limit 1), wins_purchased = null, win_package = null,
  boost_mode = 'solo' where id = (select id from cp);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
update public.booster_profiles set status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into public.accept_challenges (id, booster_id, order_id, champion_id, answer_norm, image_seed, expires_at, solved_at)
  values ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000b1', (select id from cp), 'Kaisa', 'kaisa', 1, now() + interval '1 minute', now());
select is((public.accept_boost_order((select id from cp), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000ca01')->>'error'), 'booster_not_approved',
  'booster suspenso com reserva exclusiva nao aceita');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
update public.booster_profiles set status = 'approved' where user_id = '00000000-0000-0000-0000-0000000000b1';

-- ---------- H-04: matriz de transicoes do override ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table m(from_s text, to_s text, booster boolean, paid boolean, expect text) on commit drop;
insert into m values
 ('in_progress',       'completed', true,  true,  'invalid_transition'),
 ('awaiting_assignment','completed', false, true, 'invalid_transition'),
 ('awaiting_customer', 'completed', true,  true,  'ok'),
 ('awaiting_customer', 'completed', true,  false, 'order_not_paid'),
 ('disputed',          'completed', true,  true,  'ok'),
 ('in_progress',       'canceled',  true,  true,  'use_cancel_in_progress_flow'),
 ('awaiting_assignment','canceled', false, true,  'ok'),
 ('in_progress',       'refunded',  true,  true,  'use_refund_flow'),
 ('completed',         'in_progress', true, true, 'order_terminal'),
 ('canceled',          'in_progress', false, true, 'order_terminal'),
 ('in_progress',       'paused',    true,  true,  'ok'),
 ('drop_requested',    'in_progress', true, true, 'use_resolution_flow'),
 ('in_progress',       'banana',    true,  true,  'invalid_status'),
 ('in_progress',       'in_progress', true, true, 'no_status_change');
select is(
  (select string_agg(m.from_s || '>' || m.to_s || ':' || m.expect, ' | ' order by m.from_s, m.to_s)
     from m
    where coalesce((public.admin_override_order_status(
            pg_temp.mk_order(m.from_s::public.order_status, case when m.booster then '00000000-0000-0000-0000-0000000000b1'::uuid end, m.paid),
            m.to_s, 'matriz de teste de transicoes')->>'error'), 'ok') <> m.expect),
  null, 'matriz de transicoes do override (todas as linhas conforme o esperado)');

select is((select count(*)::int from public.order_status_history h join public.orders o on o.id = h.order_id
            where h.reason = 'matriz de teste de transicoes'), 4, 'toda transicao permitida grava historico');

select is((public.update_order_status((select id from cp), 'completed', 'x')->>'error'), 'unauthorized',
  'update_order_status nao tem mais ramo admin');

-- ---------- H-06: auto-conclusao 12h e contestacao ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table a on commit drop as select
  pg_temp.mk_order('awaiting_customer', '00000000-0000-0000-0000-0000000000b1') as old12,
  pg_temp.mk_order('awaiting_customer', '00000000-0000-0000-0000-0000000000b1') as recent,
  pg_temp.mk_order('awaiting_customer', '00000000-0000-0000-0000-0000000000b1') as disp;
insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason, created_at) values
  ((select old12 from a),  'in_progress', 'awaiting_customer', '00000000-0000-0000-0000-0000000000b1', 't', now() - interval '12 hours 1 minute'),
  ((select recent from a), 'in_progress', 'awaiting_customer', '00000000-0000-0000-0000-0000000000b1', 't', now() - interval '11 hours'),
  ((select disp from a),   'in_progress', 'awaiting_customer', '00000000-0000-0000-0000-0000000000b1', 't', now() - interval '13 hours');
select is((public.dispute_order_completion((select disp from a), 'booster nao entregou')->>'success')::boolean, true, 'cliente contesta a entrega');
select is((select status::text from public.orders where id = (select disp from a)), 'disputed', 'pedido contestado vira disputed');
reset role;
select is((select public.auto_complete_awaiting_customer_orders()), 1, 'auto-conclusao processa so o pedido de 12h+');
select is((select status::text from public.orders where id = (select old12 from a)), 'completed', 'pedido sem resposta por 12h conclui sozinho');
select is((select status::text from public.orders where id = (select recent from a)), 'awaiting_customer', 'pedido de 11h segue aguardando');
select is((select status::text from public.orders where id = (select disp from a)), 'disputed', 'pedido contestado nao conclui sozinho');
select is((select count(*)::int from public.payout_records where order_id = (select old12 from a)), 1, 'auto-conclusao gera payout');
select ok(exists (select 1 from cron.job where jobname = 'auto-complete-awaiting-customer-orders'), 'cron da auto-conclusao agendado');
select is((public.get_customer_order_state((select disp from a))->>'payment_confirmed')::boolean, true, 'pedido contestado continua pago na UI');

-- ---------- H-39: status do booster com pedidos ativos ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table h on commit drop as select pg_temp.mk_order('in_progress', '00000000-0000-0000-0000-0000000000b2') as id;
select is((public.approve_booster((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b2'), 'suspended')->>'error'),
  'active_orders_exist', 'nao suspende booster com pedido em andamento');
update public.booster_profiles set status = 'removed' where user_id = '00000000-0000-0000-0000-0000000000b1';
select is((public.approve_booster((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'approved')->>'error'),
  'booster_removed', 'booster removido nao e ressuscitado');

-- ---------- M-15 / constraints ----------
select has_column('public', 'order_status_history', 'seq', 'historico tem ordem deterministica');
select throws_ok($$update public.orders set status = 'completed' where id = (select id from cp)$$,
  '23514', null, 'pedido sem booster nao pode virar concluido');
select ok(exists (select 1 from pg_indexes where indexname = 'payout_records_order_booster_unique_idx'), 'payout unico por (pedido, booster)');
select ok(not exists (select 1 from pg_indexes where indexname = 'payout_records_order_unique_idx'), 'indice unico antigo removido');

select * from finish();
rollback;
