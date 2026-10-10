-- M-52: expulsar booster devolve saldo e saques pendentes ao admin e encerra as sessoes do usuario.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);
insert into public.booster_ledger_entries (booster_id, entry_type, amount, description, actor_id, actor_role)
values ('00000000-0000-0000-0000-0000000000b1', 'manual_admin_adjustment', 80, 'saldo de teste', '00000000-0000-0000-0000-0000000000ad', 'admin');
insert into public.payout_requests (booster_id, amount, status) values ('00000000-0000-0000-0000-0000000000b1', 50, 'requested');
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000005e', '00000000-0000-0000-0000-0000000000b1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
create temp table res on commit drop as
  select public.expel_booster((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'fraude comprovada no caso', '00000000-0000-0000-0000-0000000000ad') as r;

select is(((select r from res)->>'success')::boolean, true, 'expulsao conclui');
select is(((select r from res)->>'pending_payout_requests')::int, 1, 'devolve a quantidade de saques pendentes');
select ok(((select r from res)->>'balance')::numeric > 0, 'devolve o saldo para o admin decidir');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'sessoes do usuario sao encerradas');
select is((select status::text from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'removed', 'booster fica removed');

select * from finish();
rollback;
