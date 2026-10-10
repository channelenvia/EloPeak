-- N-5: o SELECT direto em order_messages (REST/Realtime) respeita a mesma janela do RPC get_order_chat.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}');
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package,
       status, payment_status, assigned_booster_id, last_match_synced_at, match_sync_started_at)
values ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3,
        'in_progress', 'paid', '00000000-0000-0000-0000-0000000000b1', now(), now());
insert into public.order_booster_assignments (order_id, booster_id, assigned_at, unassigned_at)
values ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000b1', now() - interval '2 hours', now() - interval '1 hour');
alter table public.order_messages disable trigger trg_order_messages_rate_limit;
insert into public.order_messages (order_id, sender_id, sender_role, content, created_at) values
  ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000b1', 'booster', 'msg do booster antigo', now() - interval '90 minutes'),
  ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000c1', 'customer', 'msg do cliente depois da troca', now() - interval '10 minutes');
-- reatribuicao: B2 e o booster atual desde 1h atras
update public.orders set assigned_booster_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000c4a1';
insert into public.order_booster_assignments (order_id, booster_id, assigned_at)
values ('00000000-0000-0000-0000-00000000c4a1', '00000000-0000-0000-0000-0000000000b2', now() - interval '1 hour');


set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.order_messages where order_id = '00000000-0000-0000-0000-00000000c4a1'), 1, 'booster novo nao le o historico do anterior por SELECT direto');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.order_messages where order_id = '00000000-0000-0000-0000-00000000c4a1'), 0, 'booster antigo (desatribuido) nao le nada');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.order_messages where order_id = '00000000-0000-0000-0000-00000000c4a1'), 2, 'cliente le o historico completo');

reset role;
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.order_messages where order_id = '00000000-0000-0000-0000-00000000c4a1'), 2, 'admin le tudo');

reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@t.local', '{}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d9","role":"authenticated"}', true);
select is((select count(*)::int from public.order_messages where order_id = '00000000-0000-0000-0000-00000000c4a1'), 0, 'usuario sem relacao com o pedido nao le nada');

reset role;
select is((select count(*)::int from pg_policies where tablename = 'order_messages' and cmd = 'SELECT'), 1, 'continua uma unica policy de SELECT');

select * from finish();
rollback;
