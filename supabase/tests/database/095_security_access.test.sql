-- Acesso e seguranca que antes eram "testes de texto": agora exercitam grants, policies e RPCs de verdade.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']);

-- ---------- credenciais do pedido ----------
select ok(not has_column_privilege('authenticated', 'public.orders', 'game_credentials', 'SELECT')
      and not has_column_privilege('anon', 'public.orders', 'game_credentials', 'SELECT'),
  'game_credentials nao e legivel pelo client (select(*) nao devolve o payload cifrado)');
select ok(not has_column_privilege('authenticated', 'public.orders', 'game_credentials', 'UPDATE'), 'nem gravavel direto pelo client');
select ok(not has_function_privilege('authenticated', 'public.resolve_order_access_token(text,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.resolve_order_access_token(text,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.resolve_order_access_token(text,uuid)', 'EXECUTE'),
  'resolver o token de acesso e so da Edge (service_role): o booster autenticado nunca chama direto');

-- ---------- request_booster_role nao promove ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select lives_ok($$select public.request_booster_role()$$, 'request_booster_role responde para cliente');
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'customer', '...e nao promove o cliente a booster');

-- ---------- booster so avanca o pedido pela maquina de estados ----------
create function pg_temp.mk(p_status public.order_status, p_customer uuid default '00000000-0000-0000-0000-0000000000c1', p_package uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode, current_rank, wins_purchased, win_package,
         status, payment_status, assigned_booster_id, booster_service_id)
  values (p_customer, 's', 'g', 'br', 10, 10, 'win_boost', 'solo', '{"tier":"gold","division":"IV"}', 3, 3, p_status, 'paid',
          '00000000-0000-0000-0000-0000000000b1', p_package)
  returning id into v;
  return v;
end $$;
create temp table ord on commit drop as select pg_temp.mk('in_progress') as id;
select set_config('t.ord', (select id::text from ord), false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((public.update_order_status(current_setting('t.ord')::uuid, 'completed', 'x')->>'error'), 'invalid_transition', 'booster nao conclui direto (so o cliente confirma)');
select is((public.update_order_status(current_setting('t.ord')::uuid, 'refunded', 'x')->>'error'), 'invalid_transition', 'booster nao marca reembolsado');
select is((public.update_order_status(current_setting('t.ord')::uuid, 'banana', 'x')->>'error'), 'invalid_status', 'status inexistente e recusado sem estourar erro de cast');
select is((public.update_order_status(current_setting('t.ord')::uuid, 'paused', 'pausa')->>'success')::boolean, true, 'pausar e permitido');

-- ---------- chat: so por RPC, e so com booster atribuido ----------
select ok(not has_table_privilege('authenticated', 'public.order_messages', 'INSERT') and not has_table_privilege('authenticated', 'public.order_messages', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.order_messages', 'DELETE'), 'as telas nao gravam direto em order_messages');
create temp table nobooster on commit drop as select pg_temp.mk('awaiting_assignment') as id;
update public.orders set assigned_booster_id = null where id = (select id from nobooster);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((public.send_order_message((select id from nobooster), 'alguem ai?')->>'code'), 'chat_unavailable', 'sem booster atribuido o chat nao esta disponivel');

-- ---------- visibilidade do pacote de coaching (booster_services_read) ----------
insert into public.booster_services (id, booster_id, title, description, tempo, price, lanes, specialties, is_active)
  values ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000000b1', 'Oculto', 'd', '1h', 50, array['mid'], array['macro'], false);
create temp table pkgord on commit drop as select pg_temp.mk('in_progress', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000005e1') as id;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.booster_services where id = '00000000-0000-0000-0000-0000000005e1'), 1, 'cliente do pedido ve o pacote mesmo desativado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is((select count(*)::int from public.booster_services where id = '00000000-0000-0000-0000-0000000005e1'), 0, 'outro cliente nao ve pacote desativado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.booster_services where id = '00000000-0000-0000-0000-0000000005e1'), 1, 'o dono do pacote ve o proprio');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
select is((select count(*)::int from public.booster_services where id = '00000000-0000-0000-0000-0000000005e1'), 1, 'admin ve qualquer pacote');
reset role;

-- ---------- schema esperado (migrations antigas reduzidas a um check) ----------
select has_column('public', 'order_matches', 'minions_killed', 'order_matches guarda minions_killed');
select has_column('public', 'order_matches', 'neutral_minions_killed', 'order_matches guarda neutral_minions_killed');
select has_column('public', 'order_matches', 'is_mvp', 'order_matches guarda is_mvp');
select has_column('public', 'booster_performance_segments', 'avg_cs_per_min', 'segmentos de performance tem avg_cs_per_min');
select ok(exists (select 1 from pg_indexes where tablename = 'booster_champion_stats' and indexdef ilike '%unique%' and indexdef ilike '%booster_id%' and indexdef ilike '%champion%'),
  'booster_champion_stats tem unico por (booster, conta, campeao)');
select ok(exists (select 1 from pg_proc where proname = 'order_requires_access_token' and pg_get_function_arguments(oid) like '%service_type%'),
  'order_requires_access_token decide pelo service_type (nao pelo service_id)');

select * from finish();
rollback;
