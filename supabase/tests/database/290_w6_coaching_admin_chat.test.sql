-- W-6: H-13 teto de pacotes e total; M-15 sem DM duplicada; M-19 display_name; M-23 KPI de ativos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

-- ---------- H-13 ----------
insert into public.booster_services (booster_id, title, description, tempo, price, lanes, specialties, service_type) values
  ('00000000-0000-0000-0000-0000000000b1', 'p1', 'd', '1h', 10, array['top'], array['macro'], 'coaching'),
  ('00000000-0000-0000-0000-0000000000b1', 'p2', 'd', '1h', 10, array['top'], array['macro'], 'elo_boost'),
  ('00000000-0000-0000-0000-0000000000b1', 'p3', 'd', '1h', 10, array['top'], array['macro'], 'win_boost');
select throws_ok($$insert into public.booster_services (booster_id, title, description, tempo, price, lanes, specialties, service_type)
  values ('00000000-0000-0000-0000-0000000000b1', 'p4', 'd', '1h', 10, array['top'], array['macro'], 'md5')$$, 'P0001', 'booster_service_limit_reached',
  'H-13: o teto de 3 vale no total, mesmo com service_type diferente');

-- ---------- M-15 ----------
select ok(pg_get_functiondef('public.send_order_message(uuid,text,uuid[])'::regprocedure) not like '%discord-chat-mention%',
  'M-15: send_order_message nao chama a edge de DM (o trigger de notifications ja chama)');
select ok(exists (select 1 from pg_trigger where tgname = 'trg_notify_discord_chat_mention' and not tgisinternal), 'M-15: a DM continua saindo pelo trigger');

-- ---------- M-19 ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.update_my_display_name('[clique aqui](https://evil.example)')->>'error', 'display_name_invalid', 'M-19: markdown/link no nome e recusado');
select is(public.update_my_display_name(repeat('a', 33))->>'error', 'display_name_invalid', 'M-19: mais de 32 caracteres e recusado');
select isnt(public.update_my_display_name('João da Silva_01')->>'error', 'display_name_invalid', 'M-19: nome normal com acento passa na validacao');

-- nome legado (fora do charset novo) pode ser reenviado sem mudanca
set local session_replication_role = 'replica';
update public.booster_profiles set display_name = 'D''Ávila' where user_id = '00000000-0000-0000-0000-0000000000b1';
set local session_replication_role = 'origin';
select isnt(public.update_my_display_name('D''Ávila')->>'error', 'display_name_invalid', 'M-19: reenviar o nome legado atual nao e recusado');
select is(public.update_booster_professional_profile('[x](https://evil.example)', 'bio', 'challenger', 'https://op.gg/1', true, array['mon'], 1, 4)->>'error',
  'display_name_invalid', 'M-19: perfil profissional tambem valida o nome');

-- H-13 (2a parte): editar pacote ja ativo nao dispara o teto
select lives_ok($$update public.booster_services set title = 'p1b', service_type = 'md5' where booster_id = '00000000-0000-0000-0000-0000000000b1' and title = 'p1'$$,
  'H-13: editar/trocar tipo de pacote ativo continua permitido com o teto cheio');

-- ---------- M-23 ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
create temp table before_stats on commit drop as select (public.admin_dashboard_stats()->>'active_orders_count')::int as n;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}');
insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, payment_status)
select '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, st::public.order_status, 'paid'
from unnest(array['awaiting_customer', 'drop_requested', 'under_review', 'disputed', 'awaiting_assignment']) st;
select is((public.admin_dashboard_stats()->>'active_orders_count')::int - (select n from before_stats), 5, 'M-23: KPI conta awaiting_customer, drop_requested, under_review, disputed e awaiting_assignment');

select * from finish();
rollback;
