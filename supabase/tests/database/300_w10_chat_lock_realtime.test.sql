-- M-16: lock/unlock do chat gera evento em order_status_events (realtime) para o composer reagir na hora.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, payment_status)
values ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'in_progress', 'paid');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);

create temp table before_n on commit drop as select count(*)::int as n from public.order_status_events where order_id = '00000000-0000-0000-0000-00000000c4a1';
select is((public.admin_set_order_chat_lock('00000000-0000-0000-0000-00000000c4a1', true)->>'success')::boolean, true, 'M-16: admin bloqueia o chat');
select is((select count(*)::int from public.order_status_events where order_id = '00000000-0000-0000-0000-00000000c4a1') - (select n from before_n), 1, 'M-16: o lock emite um evento realtime');
select public.admin_set_order_chat_lock('00000000-0000-0000-0000-00000000c4a1', false);
select is((select count(*)::int from public.order_status_events where order_id = '00000000-0000-0000-0000-00000000c4a1') - (select n from before_n), 2, 'M-16: o unlock tambem');

select * from finish();
rollback;
