-- M-3: partida fora de qualquer janela de atribuicao nao conta pro booster atual.
-- M-4: pedido em drop_requested continua registrando partidas (o drop usa contadores atuais).
-- M-13: drop padrao que chega a Master+ grava o PDL atingido como nova origem.
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

create function pg_temp.mk(p_status text, p_type text default 'win_boost') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, queue_type,
         current_rank, target_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, match_sync_started_at)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 50, 50, p_type::public.service_type, 'solo', 'solo_duo',
          '{"tier":"diamond","division":"I"}', case when p_type = 'elo_boost' then '{"tier":"grandmaster"}'::jsonb end,
          case when p_type = 'win_boost' then 5 end, case when p_type = 'win_boost' then 3 end,
          p_status::public.order_status, 'paid', '00000000-0000-0000-0000-0000000000b1', now() - interval '1 hour')
  returning id into v;
  insert into public.order_booster_assignments (order_id, booster_id, assigned_at)
    values (v, '00000000-0000-0000-0000-0000000000b1', now() - interval '1 hour');
  return v;
end $$;

create function pg_temp.rec(p_order uuid, p_ext text, p_at timestamptz, p_result text default 'loss') returns jsonb language sql as $$
  select public.record_order_match(p_order, p_ext, p_result, 'Ahri', 1, 1, 1, 420, 1800, p_at, 100, 10, false, 20, null)
$$;

-- M-3
create temp table w on commit drop as select pg_temp.mk('in_progress') as id;
select is(pg_temp.rec((select id from w), 'BR1_1', now() - interval '3 hours')->>'skipped_reason', 'outside_assignment_window', 'M-3: partida antes da atribuicao e ignorada');
select is((select losses_played from public.orders where id = (select id from w)), 0, 'M-3: contador nao sobe');
select is((select count(*)::int from public.order_matches where order_id = (select id from w)), 0, 'M-3: partida nao e gravada no pedido');
select is((pg_temp.rec((select id from w), 'BR1_2', now() - interval '10 minutes')->>'inserted')::boolean, true, 'M-3: partida dentro da janela entra');
select is((select losses_played from public.orders where id = (select id from w)), 1, 'M-3: contador sobe dentro da janela');

-- M-4
create temp table d on commit drop as select pg_temp.mk('drop_requested') as id;
select is((pg_temp.rec((select id from d), 'BR1_3', now() - interval '5 minutes', 'win')->>'inserted')::boolean, true, 'M-4: drop_requested registra a partida');
select is((select wins_played from public.orders where id = (select id from d)), 1, 'M-4: contador atualizado antes de apply_order_drop');

-- M-13
create temp table e on commit drop as select pg_temp.mk('drop_requested', 'elo_boost') as id;
update public.orders set queue_type = 'solo_duo' where id = (select id from e);
insert into public.order_rank_verifications (order_id, requested_by, riot_id_checked, target_tier, passed, fetched_tier, fetched_division, fetched_lp)
  values ((select id from e), '00000000-0000-0000-0000-0000000000c1', 'x#br1', 'grandmaster', false, 'master', null, 150);
select public.apply_order_drop((select id from e), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'teste', 'admin');
select is((select current_pdl from public.orders where id = (select id from e)), 150, 'M-13: PDL atingido vira a origem do proximo booster');
select is((select stint_start_rank->>'tier' from public.orders where id = (select id from e)), 'master', 'M-13: stint reinicia em Master');

select * from finish();
rollback;
