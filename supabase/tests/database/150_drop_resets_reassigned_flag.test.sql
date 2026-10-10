-- M-14: pedido que volta ao pool por drop nao carrega reassigned_by_admin do booster anterior.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package,
       status, payment_status, assigned_booster_id, last_match_synced_at, match_sync_started_at, reassigned_by_admin)
values ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3,
        'drop_requested', 'paid', '00000000-0000-0000-0000-0000000000b1', now(), now(), true);

select is((select reassigned_by_admin from public.orders where id = '00000000-0000-0000-0000-00000000d0a1'), true, 'pre-condicao: pedido reatribuido pelo admin');
select public.apply_order_drop('00000000-0000-0000-0000-00000000d0a1', 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'saiu', 'admin');
select is((select reassigned_by_admin from public.orders where id = '00000000-0000-0000-0000-00000000d0a1'), false, 'apos o drop o pedido volta ao pool sem a marca de reatribuicao');

select * from finish();
rollback;
