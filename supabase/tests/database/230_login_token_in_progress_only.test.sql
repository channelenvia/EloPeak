-- Token de login (solo e conta duo): so emitido/aceito com orders.status = 'in_progress'; mudar status/booster invalida o token emitido.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}');
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

delete from vault.secrets where name = 'credential_key';
select vault.create_secret(repeat('k', 48), 'credential_key');

-- pedido solo em andamento com credenciais do cliente; um pedido por status terminal; um pedido duo
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, status, payment_status, assigned_booster_id, credentials_set, credential_expires_at, game_credentials) values
  ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', '{"tier":"gold","division":"IV"}', 'in_progress', 'paid', '00000000-0000-0000-0000-0000000000b1', true, now() + interval '1 day',
    pgp_sym_encrypt('{"login":"l","password":"p"}', repeat('k', 48))::text),
  ('00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', '{"tier":"gold","division":"IV"}', 'completed', 'paid', '00000000-0000-0000-0000-0000000000b1', true, now() + interval '1 day',
    pgp_sym_encrypt('{"login":"l","password":"p"}', repeat('k', 48))::text),
  ('00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', '{"tier":"gold","division":"IV"}', 'canceled', 'paid', '00000000-0000-0000-0000-0000000000b1', true, now() + interval '1 day',
    pgp_sym_encrypt('{"login":"l","password":"p"}', repeat('k', 48))::text),
  ('00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', '{"tier":"gold","division":"IV"}', 'refunded', 'paid', '00000000-0000-0000-0000-0000000000b1', true, now() + interval '1 day',
    pgp_sym_encrypt('{"login":"l","password":"p"}', repeat('k', 48))::text),
  ('00000000-0000-0000-0000-00000000f305', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'solo', '{"tier":"gold","division":"IV"}', 'disputed', 'paid', '00000000-0000-0000-0000-0000000000b1', true, now() + interval '1 day',
    pgp_sym_encrypt('{"login":"l","password":"p"}', repeat('k', 48))::text),
  ('00000000-0000-0000-0000-00000000f306', '00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, 'elo_boost', 'duo', '{"tier":"gold","division":"IV"}', 'in_progress', 'paid', '00000000-0000-0000-0000-0000000000b1', false, null, null);
insert into public.duo_accounts (id, label, current_rank, encrypted_credentials, is_active, reserved_by, reserved_order_id, reserved_at) values
  ('00000000-0000-0000-0000-00000000fda1', 'duo', '{"tier":"gold","division":"IV"}',
   encode(pgp_sym_encrypt('{"login":"dl","password":"dp"}', repeat('k', 48)), 'base64'), true,
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000f306', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

-- ---------- solo: emissao ----------
select is((public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'success')::boolean, true, 'em andamento: token emitido');
select set_config('t.tok1', public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'access_token', false);
reset role;
select is((public.resolve_order_access_token(current_setting('t.tok1'), '00000000-0000-0000-0000-0000000000b1')->>'success')::boolean, true, 'em andamento: token resolve para o booster do pedido');

-- token emitido em andamento deixa de valer quando o status muda (e nao volta quando retoma)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select set_config('t.tok2', public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'access_token', false);
reset role;
update public.orders set status = 'paused' where id = '00000000-0000-0000-0000-00000000f301';
select is(public.resolve_order_access_token(current_setting('t.tok2'), '00000000-0000-0000-0000-0000000000b1')->>'error', 'order_not_in_progress', 'pausado: token emitido antes nao resolve');
update public.orders set status = 'in_progress' where id = '00000000-0000-0000-0000-00000000f301';
select is(public.resolve_order_access_token(current_setting('t.tok2'), '00000000-0000-0000-0000-0000000000b1')->>'error', 'token_expired_or_invalid', 'ao retomar, o token da fase anterior continua invalido');

-- ---------- solo: cada outro status nao emite ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
reset role;
update public.orders set status = 'paused' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'error', 'order_not_in_progress', 'paused nao emite');
reset role;
update public.orders set status = 'assigned' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'error', 'order_not_in_progress', 'assigned nao emite');
reset role;
update public.orders set status = 'awaiting_customer' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'error', 'order_not_in_progress', 'awaiting_customer nao emite');
reset role;
update public.orders set status = 'drop_requested' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'error', 'order_not_in_progress', 'drop_requested nao emite');
reset role;
update public.orders set status = 'under_review' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'error', 'order_not_in_progress', 'under_review nao emite');
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f302')->>'error', 'order_not_in_progress', 'completed nao emite');
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f303')->>'error', 'order_not_in_progress', 'canceled nao emite');
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f304')->>'error', 'order_not_in_progress', 'refunded nao emite');
select is(public.get_order_credentials('00000000-0000-0000-0000-00000000f305')->>'error', 'order_not_in_progress', 'disputed nao emite');
reset role;
-- awaiting_assignment: sem booster (como apos drop)
update public.orders set status = 'awaiting_assignment', assigned_booster_id = null where id = '00000000-0000-0000-0000-00000000f301';
select is(public.resolve_order_access_token(current_setting('t.tok1'), '00000000-0000-0000-0000-0000000000b1')->>'success', 'false', 'aguardando atribuicao: nada resolve');

-- reatribuicao: token do booster antigo morre; outro booster nao resolve o token alheio
update public.orders set status = 'in_progress', assigned_booster_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000f301';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select set_config('t.tok3', public.get_order_credentials('00000000-0000-0000-0000-00000000f301')->>'access_token', false);
reset role;
update public.orders set assigned_booster_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000f301';
select is(public.resolve_order_access_token(current_setting('t.tok3'), '00000000-0000-0000-0000-0000000000b1')->>'success', 'false', 'reatribuido: token do booster anterior nao resolve');
select is(public.resolve_order_access_token(current_setting('t.tok3'), '00000000-0000-0000-0000-0000000000b2')->>'success', 'false', 'reatribuido: novo booster nao resolve token emitido para o anterior');

-- ---------- duo ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((public.get_duo_account_access_token('00000000-0000-0000-0000-00000000fda1')->>'success')::boolean, true, 'duo em andamento: token emitido');
select set_config('t.dtok1', public.get_duo_account_access_token('00000000-0000-0000-0000-00000000fda1')->>'access_token', false);
reset role;
select is((public.resolve_duo_account_access_token(current_setting('t.dtok1'), '00000000-0000-0000-0000-0000000000b1')->>'success')::boolean, true, 'duo em andamento: token resolve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select set_config('t.dtok2', public.get_duo_account_access_token('00000000-0000-0000-0000-00000000fda1')->>'access_token', false);
reset role;
update public.orders set status = 'paused' where id = '00000000-0000-0000-0000-00000000f306';
select is(public.resolve_duo_account_access_token(current_setting('t.dtok2'), '00000000-0000-0000-0000-0000000000b1')->>'error', 'order_not_in_progress', 'duo pausado: token emitido antes nao resolve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.get_duo_account_access_token('00000000-0000-0000-0000-00000000fda1')->>'error', 'order_not_in_progress', 'duo pausado: nao emite');
reset role;
select is((select access_token_id from public.duo_accounts where id = '00000000-0000-0000-0000-00000000fda1'), null, 'mudanca de status limpa o token ativo da conta duo');

select * from finish();
rollback;
