begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}');
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
update public.profiles set terms_accepted_at = now(), privacy_accepted_at = now(), legal_version = public.current_legal_version() where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

create function pg_temp.mk_pool() returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, credentials_set)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo',
          '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_assignment', 'paid', false)
  returning id into v;
  update public.orders set credentials_set = true, game_credentials = 'x', credential_expires_at = now() + interval '1 hour' where id = v;
  return v;
end $$;

-- ---------- permissoes: tudo do desafio e interno ----------
select ok(not has_table_privilege('authenticated', 'public.accept_challenges', 'SELECT') and not has_table_privilege('anon', 'public.accept_challenges', 'SELECT'),
  'tabela de desafios nao e legivel pelo client (a resposta nunca chega ao navegador)');
select ok(not has_function_privilege('authenticated', 'public.verify_accept_challenge(uuid,uuid,text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.issue_accept_challenge(uuid,uuid,text,text,integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.verify_accept_challenge(uuid,uuid,text)', 'EXECUTE'),
  'emitir/verificar so pela Edge (service_role)');
select is((select count(*)::int from pg_proc where proname = 'accept_boost_order' and pronamespace = 'public'::regnamespace), 1, 'sem overload orfao de accept_boost_order');

-- ---------- fluxo ----------
create temp table o on commit drop as select pg_temp.mk_pool() as id;
create temp table ch on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', (select id from o), 'Kaisa', 'kaisa', 42) as id;

select set_config('t.o', (select id::text from o), false), set_config('t.ch', (select id::text from ch), false);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.accept_boost_order(current_setting('t.o')::uuid, '00000000-0000-0000-0000-0000000000b1', current_setting('t.ch')::uuid)->>'error'), 'captcha_required', 'sem resolver o desafio, aceitar e recusado');
select is((public.accept_boost_order(current_setting('t.o')::uuid, '00000000-0000-0000-0000-0000000000b1', gen_random_uuid())->>'error'), 'captcha_required', 'id de desafio inventado e recusado');
reset role;

select is((public.verify_accept_challenge((select id from ch), '00000000-0000-0000-0000-0000000000b2', 'kaisa')->>'error'), 'challenge_not_found', 'outro booster nao resolve o desafio alheio');
select is((public.verify_accept_challenge((select id from ch), '00000000-0000-0000-0000-0000000000b1', 'ahri')->>'error'), 'wrong_answer', 'resposta errada');
select is((public.verify_accept_challenge((select id from ch), '00000000-0000-0000-0000-0000000000b1', 'kaisa')->>'success')::boolean, true, 'resposta certa');
select is((public.get_accept_challenge_image_data((select id from ch))), null::jsonb, 'imagem so e servida enquanto o desafio esta em aberto');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((public.accept_boost_order(current_setting('t.o')::uuid, '00000000-0000-0000-0000-0000000000b2', current_setting('t.ch')::uuid)->>'error'), 'captcha_required', 'desafio resolvido por outro booster nao serve');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.accept_boost_order(current_setting('t.o')::uuid, '00000000-0000-0000-0000-0000000000b1', current_setting('t.ch')::uuid)->>'success')::boolean, true, 'com o desafio resolvido o aceite passa');
reset role;
select is((select status::text from public.orders where id = (select id from o)), 'in_progress', 'pedido aceito');

-- uso unico
update public.orders set status = 'awaiting_assignment', assigned_booster_id = null where id = (select id from o);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.accept_boost_order(current_setting('t.o')::uuid, '00000000-0000-0000-0000-0000000000b1', current_setting('t.ch')::uuid)->>'error'), 'captcha_required', 'prova de uso unico: reaproveitar o desafio e recusado');
reset role;

-- tentativas: 3 erros queimam o desafio
create temp table ch2 on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', (select id from o), 'Ahri', 'ahri', 7) as id;
select public.verify_accept_challenge((select id from ch2), '00000000-0000-0000-0000-0000000000b1', 'x1');
select public.verify_accept_challenge((select id from ch2), '00000000-0000-0000-0000-0000000000b1', 'x2');
select is((public.verify_accept_challenge((select id from ch2), '00000000-0000-0000-0000-0000000000b1', 'x3')->>'attempts_left')::int, 0, 'terceira tentativa errada zera o contador');
select is((public.verify_accept_challenge((select id from ch2), '00000000-0000-0000-0000-0000000000b1', 'ahri')->>'error'), 'challenge_expired', '...e queima o desafio (nem a resposta certa passa depois)');

-- expiracao
create temp table ch3 on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', (select id from o), 'Jinx', 'jinx', 9) as id;
update public.accept_challenges set expires_at = now() - interval '1 second' where id = (select id from ch3);
select is((public.verify_accept_challenge((select id from ch3), '00000000-0000-0000-0000-0000000000b1', 'jinx')->>'error'), 'challenge_expired', 'desafio expirado nao valida');

-- emitir novo descarta o aberto anterior
create temp table ch4 on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', (select id from o), 'Lux', 'lux', 3) as id;
create temp table ch5 on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', (select id from o), 'Zed', 'zed', 4) as id;
select is((public.verify_accept_challenge((select id from ch4), '00000000-0000-0000-0000-0000000000b1', 'lux')->>'error'), 'challenge_expired', 'novo desafio invalida o anterior do mesmo pedido');

-- ---------- W5 (2/2): cartao e anuncio de exclusividade ----------
select is((select count(*)::int from pg_proc where proname = 'record_card_payment' and pronamespace = 'public'::regnamespace), 1, 'record_card_payment sem overload orfao');
select ok(has_function_privilege('service_role', 'public.record_card_payment(uuid,uuid,text,numeric,text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.record_card_payment(uuid,uuid,text,numeric,text)', 'EXECUTE'),
  'record_card_payment so para a Edge (service_role)');

create temp table cp on commit drop as select pg_temp.mk_pool() as id;
update public.orders set status = 'awaiting_payment', payment_status = 'pending', mp_payment_id = null, credentials_set = false, game_credentials = null, credential_expires_at = null where id = (select id from cp);
select public.record_card_payment((select id from cp), '00000000-0000-0000-0000-0000000000c1', 'mp-card-1', 10, 'debit_card');
select is((select payment_method_type from public.payments where order_id = (select id from cp)), 'debit_card', 'cartao grava o tipo do metodo (debito)');

update public.orders set exclusive_expired_announced_at = now() where id = (select id from o);
update public.orders set exclusive_until = now() + interval '9 hours' where id = (select id from o);
select is((select exclusive_expired_announced_at from public.orders where id = (select id from o)), null::timestamptz, 'nova exclusividade zera o marcador de anuncio');

select * from finish();
rollback;
