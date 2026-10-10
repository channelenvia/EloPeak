-- Elo declarado pelo cliente (fallback quando a Riot nao acha rank) + avaliacao do sistema visivel so ao admin.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, payment_status)
values ('00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_assignment', 'paid');

select is((select rank_source from public.orders where id = '00000000-0000-0000-0000-00000000f1a1'), 'riot', 'pedido novo nasce com rank_source riot');
select throws_ok($$update public.orders set rank_source = 'qualquer' where id = '00000000-0000-0000-0000-00000000f1a1'$$, '23514', null, 'rank_source so aceita riot ou client_declared');
update public.orders set rank_source = 'client_declared' where id = '00000000-0000-0000-0000-00000000f1a1';
select is((select rank_source from public.orders where id = '00000000-0000-0000-0000-00000000f1a1'), 'client_declared', 'pode ser marcado como declarado pelo cliente');
select ok(has_column_privilege('authenticated', 'public.orders', 'rank_source', 'SELECT'), 'rank_source e legivel pelas telas');

insert into public.order_rank_assessments (order_id, status, summary) values ('00000000-0000-0000-0000-00000000f1a1', 'suspicious', '{"estimated_tier":"silver"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.order_rank_assessments), 0, 'cliente nao ve a avaliacao do sistema');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is((select count(*)::int from public.order_rank_assessments), 1, 'admin ve a avaliacao');
select throws_ok($$insert into public.order_rank_assessments (order_id, status) values ('00000000-0000-0000-0000-00000000f1a1', 'consistent')$$, '42501', null, 'ninguem grava pela API (so a Edge com service_role)');
reset role;

select has_column('public', 'available_boost_orders', 'rank_source', 'o pool de jobs tambem informa a origem do elo');
select ok(not has_table_privilege('anon', 'public.available_boost_orders', 'SELECT') and not has_table_privilege('authenticated', 'public.available_boost_orders', 'UPDATE'),
  'view segue sem acesso anon e sem escrita');

select * from finish();
rollback;
