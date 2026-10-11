-- C-1: o sync grava o rank ao vivo em orders.current_rank; o progresso do elo_boost e a pct de drop
-- precisam continuar medidos a partir do rank INICIAL do stint (stint_start_rank), nao do rank ao vivo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

-- elo_boost Ouro IV -> Esmeralda IV, em andamento; booster ja verificou Platina IV 50 LP
create temp table elo on commit drop as
  with o as (
    insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, queue_type,
           current_rank, target_rank, status, payment_status, assigned_booster_id, match_sync_started_at, last_match_synced_at)
    values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 215.20, 215.20, 'elo_boost', 'solo', 'solo_duo',
            '{"tier":"gold","division":"IV"}', '{"tier":"emerald","division":"IV"}', 'in_progress', 'paid',
            '00000000-0000-0000-0000-0000000000b1', now(), now())
    returning id)
  select id from o;
insert into public.order_booster_assignments (order_id, booster_id)
  values ((select id from elo), '00000000-0000-0000-0000-0000000000b1');
insert into public.order_rank_verifications (order_id, requested_by, riot_id_checked, target_tier, passed, fetched_tier, fetched_division, fetched_lp)
  values ((select id from elo), '00000000-0000-0000-0000-0000000000c1', 'x#br1', 'emerald', false, 'platinum', 'IV', 50);

select is(round(public._order_progress_fraction((select id from elo)), 4), 0.4812, 'antes do sync: Ouro IV > Esmeralda IV em Platina IV 50 LP = 48,1%');

-- o sync reescreve o rank ao vivo (mesmo valor da verificacao)
select is((public.update_order_current_rank((select id from elo), 'platinum', 'IV', 50)->>'success')::boolean, true, 'sync grava o rank ao vivo');
select is((select current_rank->>'tier' from public.orders where id = (select id from elo)), 'platinum', 'current_rank segue ao vivo (checkpoint do sync)');
select is((select stint_start_rank->>'tier' from public.orders where id = (select id from elo)), 'gold', 'stint_start_rank guarda o rank inicial do stint');
select is(round(public._order_progress_fraction((select id from elo)), 4), 0.4812, 'depois do sync: progresso nao zera (C-1)');

-- syncs seguintes nao movem o inicio do stint
select public.update_order_current_rank((select id from elo), 'platinum', 'III', 10);
select is((select stint_start_rank->>'tier' from public.orders where id = (select id from elo)), 'gold', 'segundo sync preserva stint_start_rank');
select ok(public.order_drop_completion_pct((select id from elo)) > 0, 'pct de conclusao do drop usa a origem do stint');

-- drop: o rank atingido vira a nova origem do stint
select public.apply_order_drop((select id from elo), 'in_progress', '00000000-0000-0000-0000-0000000000ad', 'teste', 'admin');
select is((select stint_start_rank->>'tier' from public.orders where id = (select id from elo)),
          (select current_rank->>'tier' from public.orders where id = (select id from elo)), 'apos o drop a origem do stint acompanha o rank atingido');
select ok(not exists (select 1 from public.orders where id = (select id from elo) and stint_start_rank is null), 'stint_start_rank preenchido');

select * from finish();
rollback;
