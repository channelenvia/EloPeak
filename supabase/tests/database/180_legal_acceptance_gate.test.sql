-- H-19: aceitar job exige aceite dos termos vigentes (checado no servidor, nao so no front).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}');
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package, status, payment_status)
values ('00000000-0000-0000-0000-00000000e1a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_assignment', 'paid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.accept_boost_order('00000000-0000-0000-0000-00000000e1a1', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid())->>'error', 'legal_not_accepted',
  'booster sem aceite dos termos vigentes nao aceita job');

update public.profiles set terms_accepted_at = now(), privacy_accepted_at = now(), legal_version = 'versao-antiga' where id = '00000000-0000-0000-0000-0000000000b1';
select is(public.accept_boost_order('00000000-0000-0000-0000-00000000e1a1', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid())->>'error', 'legal_not_accepted',
  'aceite de versao antiga dos termos tambem barra');

update public.profiles set legal_version = public.current_legal_version() where id = '00000000-0000-0000-0000-0000000000b1';
select isnt(public.accept_boost_order('00000000-0000-0000-0000-00000000e1a1', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid())->>'error', 'legal_not_accepted',
  'com o aceite vigente a checagem legal passa (o resto segue com as outras regras, ex.: captcha)');

select * from finish();
rollback;
