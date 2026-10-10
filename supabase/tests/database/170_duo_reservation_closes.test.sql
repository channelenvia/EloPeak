-- H-17: limpar reserved_* da conta duo (drop, fim do pedido, liberacao) tambem fecha a reserva aberta,
-- senao o indice unico parcial bloqueia a proxima reserva (unique_violation).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package,
       status, payment_status, assigned_booster_id, last_match_synced_at, match_sync_started_at)
values ('00000000-0000-0000-0000-00000000d1a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'duo', '{"tier":"gold","division":"IV"}', 3, 3,
        'drop_requested', 'paid', '00000000-0000-0000-0000-0000000000b1', now(), now());
insert into public.duo_accounts (id, game_id, label, is_active, reserved_by, reserved_order_id, reserved_at)
values ('00000000-0000-0000-0000-00000000d2a1', 'g', 'conta', false, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d1a1', now());
insert into public.duo_account_reservations (account_id, order_id, booster_id, reserved_at)
values ('00000000-0000-0000-0000-00000000d2a1', '00000000-0000-0000-0000-00000000d1a1', '00000000-0000-0000-0000-0000000000b1', now());

select public.apply_order_drop('00000000-0000-0000-0000-00000000d1a1', 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'saiu', 'admin');
select is((select count(*)::int from public.duo_account_reservations where order_id = '00000000-0000-0000-0000-00000000d1a1' and released_at is null), 0, 'drop fecha a reserva aberta da conta duo');

-- fim do pedido tambem fecha
update public.duo_accounts set reserved_by = '00000000-0000-0000-0000-0000000000b1', reserved_order_id = '00000000-0000-0000-0000-00000000d1a1', reserved_at = now() where id = '00000000-0000-0000-0000-00000000d2a1';
insert into public.duo_account_reservations (account_id, order_id, booster_id, reserved_at)
values ('00000000-0000-0000-0000-00000000d2a1', '00000000-0000-0000-0000-00000000d1a1', '00000000-0000-0000-0000-0000000000b1', now());
update public.orders set status = 'canceled' where id = '00000000-0000-0000-0000-00000000d1a1';
select is((select count(*)::int from public.duo_account_reservations where order_id = '00000000-0000-0000-0000-00000000d1a1' and released_at is null), 0, 'fim do pedido fecha a reserva');
select lives_ok($$insert into public.duo_account_reservations (account_id, booster_id, reserved_at) values ('00000000-0000-0000-0000-00000000d2a1', '00000000-0000-0000-0000-0000000000b1', now())$$, 'a proxima reserva da mesma conta nao estoura unique_violation');

select * from finish();
rollback;
