begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.set_booster_admin_note((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'x')->>'error', 'unauthorized', 'booster nao escreve nota de admin');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is((public.set_booster_admin_note((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'nota interna')->>'success')::boolean, true, 'admin grava a nota');
select is((select count(*)::int from public.audit_logs where action = 'booster.admin_note_set' and entity_id = (select id::text from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1')), 1, 'a gravacao fica no audit_logs');
select is(public.set_booster_admin_note((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), repeat('x', 2001))->>'error', 'note_too_long', 'nota gigante e recusada');

select * from finish();
rollback;
