begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  (select count(*) from pg_tables where schemaname = 'public') >= 38,
  'baseline cria as tabelas do schema public');

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'RLS ativo em todas as tabelas de public');

select has_trigger('auth', 'users', 'on_auth_user_created', 'signup cria o profile');
select has_function('public', 'accept_boost_order', array['uuid', 'uuid', 'uuid'], 'accept_boost_order existe');
select has_function('public', 'apply_order_drop', 'apply_order_drop existe');
select ok(exists (select 1 from storage.buckets where id = 'payout-proofs' and not public),
  'bucket payout-proofs privado');
select ok((select count(*) from cron.job) >= 5, 'crons SQL agendados');

select * from finish();
rollback;
