-- L-16: can_booster_accept_order so responde para o proprio booster (ou admin/service).
-- L-17: avaliacao exige booster definido.
-- L-12: nenhuma policy fica em roles={public} sem que o anon tenha acesso a tabela.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.can_booster_accept_order('00000000-0000-0000-0000-0000000000b1', 'solo', 'win_boost')$$, null, 'forbidden',
  'cliente nao consulta a ocupacao de slots de um booster');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((public.can_booster_accept_order('00000000-0000-0000-0000-0000000000b1', 'solo', 'win_boost')->>'allowed')::boolean, true, 'o proprio booster consulta normalmente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is((public.can_booster_accept_order('00000000-0000-0000-0000-0000000000b1', 'solo', 'win_boost')->>'allowed')::boolean, true, 'admin consulta qualquer booster');

select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relnamespace = 'public'::regnamespace and p.polroles = '{0}'
             and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')), 0,
  'policies de tabelas sem acesso anon sao restritas a authenticated');
select ok(pg_get_expr((select polwithcheck from pg_policy where polname = 'reviews_customer_insert'), 'public.reviews'::regclass) ilike '%booster_id IS NOT NULL%',
  'avaliacao exige booster_id');
select * from finish();
rollback;
