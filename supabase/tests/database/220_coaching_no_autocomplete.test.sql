-- N-4: coaching nunca conclui sozinho (a auto-conclusao de 12 h pagaria 70% sem entrega verificavel); admin e avisado uma vez.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, status, payment_status, assigned_booster_id)
values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'coaching', 'solo', '{"tier":"gold","division":"IV"}', 'awaiting_customer', 'paid', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 'awaiting_customer', 'paid', '00000000-0000-0000-0000-0000000000b1');
update public.orders set wins_purchased = 3, win_package = 3 where id = '00000000-0000-0000-0000-00000000c0a2';
insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason, created_at) values
  ('00000000-0000-0000-0000-00000000c0a1', 'in_progress', 'awaiting_customer', '00000000-0000-0000-0000-0000000000b1', 't', now() - interval '13 hours'),
  ('00000000-0000-0000-0000-00000000c0a2', 'in_progress', 'awaiting_customer', '00000000-0000-0000-0000-0000000000b1', 't', now() - interval '13 hours');

select is((select public.auto_complete_awaiting_customer_orders()), 1, 'so o pedido nao-coaching e concluido');
select is((select status::text from public.orders where id = '00000000-0000-0000-0000-00000000c0a1'), 'awaiting_customer', 'coaching segue aguardando o cliente apos 12 h');
select is((select status::text from public.orders where id = '00000000-0000-0000-0000-00000000c0a2'), 'completed', 'regra de 12 h segue valendo para os demais servicos');
select is((select count(*)::int from public.payout_records where order_id = '00000000-0000-0000-0000-00000000c0a1'), 0, 'coaching sem payout automatico');
select is((select count(*)::int from public.notifications where type = 'coaching_awaiting_customer_stale' and user_id = '00000000-0000-0000-0000-0000000000ad'), 1, 'admin e avisado do coaching parado');
select public.auto_complete_awaiting_customer_orders();
select is((select count(*)::int from public.notifications where type = 'coaching_awaiting_customer_stale' and user_id = '00000000-0000-0000-0000-0000000000ad'), 1, 'aviso nao se repete a cada execucao do cron');

select * from finish();
rollback;
