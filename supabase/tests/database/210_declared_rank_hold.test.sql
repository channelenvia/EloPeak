-- N-3: pedido com elo declarado pelo cliente entra travado em pending_review e avisa o admin; pedido com elo da Riot segue o fluxo normal.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, payment_status, rank_source)
values
  ('00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_payment', 'pending', 'client_declared'),
  ('00000000-0000-0000-0000-00000000f1a2', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_payment', 'pending', 'riot');

update public.orders set status = 'pending_review', payment_status = 'paid', review_release_at = now() - interval '1 minute' where id in ('00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-00000000f1a2');

select is((select admin_review_locked from public.orders where id = '00000000-0000-0000-0000-00000000f1a1'), true, 'elo declarado entra em pending_review travado');
select is((select admin_review_locked from public.orders where id = '00000000-0000-0000-0000-00000000f1a2'), false, 'elo da Riot nao e travado');
select is((select count(*)::int from public.notifications where type = 'order_declared_rank_review' and user_id = '00000000-0000-0000-0000-0000000000ad' and (data->>'order_id')::uuid = '00000000-0000-0000-0000-00000000f1a1'), 1, 'admin e avisado do elo declarado');

select public.release_pending_review_orders();
select is((select status::text from public.orders where id = '00000000-0000-0000-0000-00000000f1a1'), 'pending_review', 'a liberacao automatica nao libera o pedido declarado');
select isnt((select status::text from public.orders where id = '00000000-0000-0000-0000-00000000f1a2'), 'pending_review', 'a liberacao automatica segue liberando o pedido da Riot');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is((public.admin_set_pending_review_lock('00000000-0000-0000-0000-00000000f1a1', false))->>'success', 'true', 'admin libera manualmente apos conferir');
reset role;

select * from finish();
rollback;
