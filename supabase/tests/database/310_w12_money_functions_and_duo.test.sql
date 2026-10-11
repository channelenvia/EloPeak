-- A14-07/A14-08/A14-10: funcoes de dinheiro com asserts proprios, contagem duo (invariante 3) e fronteira de fuso do saque.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}');
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days, is_top3) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon'], true),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon'], false);

-- ---------- A14-10: fronteira de fuso (America/Sao_Paulo, UTC-3) ----------
select is(public.is_payout_window_day('2026-08-16 02:30+00'), true, 'A14-10: 02:30Z do dia 16 ainda e dia 15 em Sao Paulo');
select is(public.is_payout_window_day('2026-08-15 02:30+00'), false, 'A14-10: 02:30Z do dia 15 ainda e dia 14 em Sao Paulo');
select is(public.is_payout_window_day('2026-09-01 02:30+00'), true, 'A14-10: 02:30Z do dia 1 ainda e o ultimo dia do mes anterior');

-- ---------- A14-07: comissao e preco por degrau ----------
select is(public._booster_share_pct('00000000-0000-0000-0000-0000000000b1', 'coaching'), 0.70, 'A14-07: coaching paga 70%');
select is(public._booster_share_pct('00000000-0000-0000-0000-0000000000b1', 'elo_boost'), 0.60, 'A14-07: top 3 paga 60%');
select is(public._booster_share_pct('00000000-0000-0000-0000-0000000000b2', 'elo_boost'), 0.55, 'A14-07: demais pagam 55%');
select ok(public._elo_step_cents('solo_duo', 'duo', 5) >= public._elo_step_cents('solo_duo', 'solo', 5) and public._elo_step_cents('solo_duo', 'solo', 5) > 0,
  'A14-07: degrau tem preco e duo nunca e mais barato que solo');

-- ---------- A14-08: duo so conta partida com co-participacao (invariante 3) ----------
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, queue_type,
       current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, match_sync_started_at, customer_lanes)
values ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 20, 20, 'win_boost', 'duo', 'solo_duo',
        '{"tier":"gold","division":"IV"}', 3, 3, 'in_progress', 'paid', '00000000-0000-0000-0000-0000000000b1', now() - interval '1 hour', array['top']);
insert into public.order_booster_assignments (order_id, booster_id, assigned_at)
  values ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000b1', now() - interval '1 hour');

create function pg_temp.duo_match(p_ext text, p_participated boolean) returns jsonb language sql as $$
  select public.record_order_match('00000000-0000-0000-0000-00000000d0a1', p_ext, 'win', 'Ahri', 1, 1, 1, 420, 1800,
    now() - interval '10 minutes', 100, 10, false, 20, p_participated)
$$;
select pg_temp.duo_match('BR1_D1', true);
select pg_temp.duo_match('BR1_D2', true);
select is(pg_temp.duo_match('BR1_D3', false)->>'skipped_reason', 'duo_not_participated', 'A14-08: vitoria sem a conta duo e ignorada');
select is((select wins_played from public.orders where id = '00000000-0000-0000-0000-00000000d0a1'), 2, 'A14-08: so as 2 vitorias co-participadas contam');

select * from finish();
rollback;
