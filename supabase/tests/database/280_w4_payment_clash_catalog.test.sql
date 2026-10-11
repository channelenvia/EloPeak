-- W-4: H-5 reabertura paga de Clash com outro Clash ativo; L-5 approved tardio nao desfaz reembolso; M-12 seeds dos catalogos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}');

-- ---------- M-12 ----------
select is((select count(*)::int from public.win_price_cents_catalog), 40, 'M-12: win_price_cents_catalog com as 40 linhas');
select is((select count(*)::int from public.master_plus_pricing where pdl_from = 0), 9, 'M-12: master_plus_pricing com as 9 linhas base');
select is(public.win_price_cents('flex', 'duo', 'master'), 8515, 'M-12: preco de vitoria resolve (penalidade de drop deixa de ser NULL)');

-- ---------- H-5 ----------
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, status, payment_status, clash_tier, clash_day, mp_payment_id, amount_paid)
values ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'clash', 'solo', 'canceled', 'pending', 'tier_2', 'saturday', 'mp-a', null),
       ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'clash', 'solo', 'awaiting_payment', 'pending', 'tier_2', 'sunday', 'mp-b', null);
insert into public.payments (order_id, customer_id, mp_payment_id, amount, currency, status)
values ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'mp-a', 10, 'brl', 'pending');

select is((public.process_mp_payment_event('00000000-0000-0000-0000-00000000c0a1', 'mp-a', 'approved', 10, 'brl', 'evt-a')->>'success')::boolean, true,
  'H-5: pagamento aprovado reabre o Clash cancelado mesmo com outro Clash ativo');
select ok((select status::text not in ('canceled', 'awaiting_payment') and payment_status::text = 'paid' from public.orders where id = '00000000-0000-0000-0000-00000000c0a1'), 'H-5: pedido pago sai de cancelado e segue o fluxo');
select is((select status::text from public.payments where mp_payment_id = 'mp-a'), 'paid', 'H-5: pagamento registrado como paid');

-- ---------- L-5 ----------
update public.payments set status = 'partially_refunded', refunded_amount = 4 where mp_payment_id = 'mp-a';
select public.process_mp_payment_event('00000000-0000-0000-0000-00000000c0a1', 'mp-a', 'approved', 10, 'brl', 'evt-a2');
select is((select status::text from public.payments where mp_payment_id = 'mp-a'), 'partially_refunded', 'L-5: approved tardio nao desfaz reembolso parcial');
update public.payments set status = 'refunded', refunded_amount = 10 where mp_payment_id = 'mp-a';
select public.process_mp_payment_event('00000000-0000-0000-0000-00000000c0a1', 'mp-a', 'approved', 10, 'brl', 'evt-a3');
select is((select status::text from public.payments where mp_payment_id = 'mp-a'), 'refunded', 'L-5: nem reembolso total');

-- ---------- H-5: o teto segue valendo para troca de tipo/dono ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c2@t.local', '{}');
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, status, payment_status, queue_type, current_rank, target_rank)
values ('00000000-0000-0000-0000-00000000e1b1', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', 'in_progress', 'paid', 'solo_duo', '{"tier":"gold","division":"IV"}', '{"tier":"platinum","division":"IV"}');
select throws_ok($$update public.orders set service_type = 'clash', clash_tier = 'tier_2', clash_day = 'saturday' where id = '00000000-0000-0000-0000-00000000e1b1'$$,
  'P0001', 'active_clash_order_exists', 'H-5: virar Clash com outro Clash ativo continua barrado');
update public.orders set customer_id = '00000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-00000000c0b1';
select throws_ok($$update public.orders set customer_id = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-00000000c0b1'$$,
  'P0001', 'active_clash_order_exists', 'H-5: trocar o dono para quem ja tem Clash ativo continua barrado');

-- ---------- L-5: pagamento reembolsado nao reabre nem paga o pedido ----------
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, status, payment_status, queue_type, mp_payment_id, current_rank, target_rank)
values ('00000000-0000-0000-0000-00000000e1c1', '00000000-0000-0000-0000-0000000000c2', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', 'canceled', 'pending', 'solo_duo', 'mp-c', '{"tier":"gold","division":"IV"}', '{"tier":"platinum","division":"IV"}');
insert into public.payments (order_id, customer_id, mp_payment_id, amount, currency, status, refunded_amount)
values ('00000000-0000-0000-0000-00000000e1c1', '00000000-0000-0000-0000-0000000000c2', 'mp-c', 10, 'brl', 'refunded', 10);
select public.process_mp_payment_event('00000000-0000-0000-0000-00000000e1c1', 'mp-c', 'approved', 10, 'brl', 'evt-c');
select is((select status::text from public.orders where id = '00000000-0000-0000-0000-00000000e1c1'), 'canceled', 'L-5: approved tardio com pagamento reembolsado nao reabre o pedido');

select * from finish();
rollback;
