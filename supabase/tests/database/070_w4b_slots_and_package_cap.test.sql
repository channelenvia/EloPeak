begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}');
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

-- ---------- M-11: vagas ----------
insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
       current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id)
select '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo',
       '{"tier":"gold","division":"IV"}', 3, 3, st::public.order_status, 'paid', '00000000-0000-0000-0000-0000000000b1'
from unnest(array['in_progress', 'drop_requested', 'under_review', 'disputed', 'completed']) st;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select total_count from public.booster_active_slot_counts('00000000-0000-0000-0000-0000000000b1')), 4,
  'vagas contam in_progress, drop_requested, under_review e disputed (completed nao)');

-- ---------- M-05: teto de 3 pacotes ----------
create function pg_temp.pkg(p_type text default 'coaching') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.booster_services (booster_id, title, description, tempo, price, lanes, specialties, service_type)
  values ('00000000-0000-0000-0000-0000000000b1', 'P', 'd', '1h', 50, array['mid'], array['macro'], p_type)
  returning id into v;
  return v;
end $$;

create temp table p on commit drop as select pg_temp.pkg() as a, pg_temp.pkg() as b, pg_temp.pkg() as c;
select throws_ok($$select pg_temp.pkg()$$, 'P0001', 'booster_service_limit_reached', '4o pacote ativo e recusado');

update public.booster_services set deleted_at = now() where id = (select a from p);
select lives_ok($$select pg_temp.pkg()$$, 'apagar um pacote libera uma vaga');
select throws_ok($$update public.booster_services set deleted_at = null where id = (select a from p)$$,
  'P0001', 'booster_service_limit_reached', 'reativar o apagado alem do teto e recusado (nao burla por soft delete)');

select throws_ok($$update public.booster_services set deleted_at = null, is_active = true where id = (select a from p)$$,
  'P0001', 'booster_service_limit_reached', 'idem com is_active');

select lives_ok($$update public.booster_services set title = 'Novo titulo' where id = (select b from p)$$, 'editar pacote existente continua livre');
select lives_ok($$update public.booster_services set deleted_at = now() where id = (select b from p)$$, 'apagar nunca e bloqueado');
select ok(exists (select 1 from pg_trigger where tgname = 'trg_cap_coach_packages' and tgenabled = 'O'), 'trigger do teto ativo para INSERT e UPDATE');

select * from finish();
rollback;
