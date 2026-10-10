-- L-13: admin que tambem e booster nao aprova/paga o proprio saque nem ajusta o proprio saldo.
-- L-14: o limite de 1 Clash ativo vale tambem em UPDATE (override de status nao cria um segundo ativo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@t.local', '{}');
update public.profiles set role = 'admin' where id in ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-0000000000a2');
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000ad', 'AD', 'approved', 'Admin Booster', 'a@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

insert into public.payout_requests (id, booster_id, amount, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ad', 100, 'requested'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000ad', 100, 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000b1', 100, 'requested');
insert into storage.objects (bucket_id, name) values ('payout-proofs', '00000000-0000-0000-0000-0000000000f2/p.png');

-- ---------- admin agindo sobre si mesmo ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is(public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f1', 'approved', 'ok')->>'error', 'cannot_review_own_request',
  'admin nao aprova o proprio saque');
select is(public.admin_mark_payout_paid('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2/p.png')->>'error', 'cannot_review_own_request',
  'admin nao marca o proprio saque como pago');
select is(public.admin_adjust_booster_balance('00000000-0000-0000-0000-0000000000ad', 50, 'ajuste no proprio saldo')->>'error', 'cannot_adjust_own_balance',
  'admin nao ajusta o proprio saldo');
select is((public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f1', 'rejected', 'desisti')->>'success')::boolean, true,
  'rejeitar o proprio saque continua permitido (devolve a reserva)');
select is((public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f3', 'approved', 'ok')->>'success')::boolean, true,
  'admin aprova saque de outro booster');
select is((public.admin_adjust_booster_balance('00000000-0000-0000-0000-0000000000b1', 50, 'ajuste de outro booster')->>'success')::boolean, true,
  'admin ajusta o saldo de outro booster');

-- ---------- limite de Clash ativo em UPDATE ----------
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, status, payment_status, clash_tier, clash_day)
values ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'clash', 'solo', 'canceled', 'paid', 'tier_2', 'saturday');
insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, status, payment_status, clash_tier, clash_day)
values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'clash', 'solo', 'in_progress', 'paid', 'tier_2', 'saturday');
select throws_ok(format($$update public.orders set status = 'in_progress' where id = %L$$, '00000000-0000-0000-0000-00000000c0a1'::uuid), 'P0001', 'active_clash_order_exists',
  'reativar um Clash cancelado nao cria um segundo ativo');
select lives_ok($$update public.orders set status = 'paused' where customer_id = '00000000-0000-0000-0000-0000000000c1' and status = 'in_progress'$$,
  'mexer no unico Clash ativo (in_progress -> paused) segue permitido');
select lives_ok(format($$update public.orders set customer_notes = 'x' where id = %L$$, '00000000-0000-0000-0000-00000000c0a1'::uuid),
  'editar campo nao relacionado de um Clash terminal nao dispara a regra');

select * from finish();
rollback;
