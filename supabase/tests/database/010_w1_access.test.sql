begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ---------- usuarios de teste ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cust@test.local', '{"role":"booster"}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'boost@test.local', '{}');

update public.profiles set role = 'booster' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'Boost', 'approved', 'Booster Teste', 'boost@test.local', '52998224725',
        '{"tier":"challenger"}', 'https://op.gg/x', 1, 4, array['mon']);

-- ---------- grants ----------
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
               or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
               or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
               or has_table_privilege('anon', c.oid, 'DELETE'))),
        0, 'nenhuma view de public aceita escrita de anon/authenticated');

select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
               or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE'))),
        0, 'anon sem DML em nenhuma tabela de public');

select is((select string_agg(c.relname, ',' order by c.relname) from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
               or has_table_privilege('authenticated', c.oid, 'DELETE'))
             or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                          and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
                          and c.relnamespace = 'public'::regnamespace and c.relkind = 'r')),
        'booster_services,notifications,profiles',
        'authenticated escreve direto so em booster_services, notifications e profiles (reviews: insert por coluna)');

select ok(not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.payments', 'INSERT')
      and not has_table_privilege('authenticated', 'public.payout_records', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
      and not has_table_privilege('authenticated', 'public.booster_profiles', 'UPDATE'),
  'admin/booster nao escrevem dinheiro, historico nem booster_profiles pelo REST');

select is((select count(*)::int from pg_policies where schemaname = 'public'
            and policyname in ('orders_update','payments_admin_insert','payments_admin_update','payments_admin_delete',
                               'payout_records_admin_update','order_status_history_insert','audit_logs_insert')),
          0, 'policies de escrita admin direta removidas');

select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
             and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
          0, 'funcoes de trigger nao sao RPC');

select ok(not has_function_privilege('anon', 'public.onboard_booster(text,text,jsonb,text,integer,integer,text,text,text[])', 'EXECUTE')
      and not has_function_privilege('anon', 'public.can_booster_accept_order(uuid,text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.order_drop_completion_pct(uuid)', 'EXECUTE'),
  'anon nao executa RPCs de booster/pedido');

-- ---------- view do pool (RN-11) ----------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'available_boost_orders'
              and column_name in ('riot_id','assigned_booster_id','match_sync_started_at')),
          0, 'pool nao expoe riot_id nem dados de atribuicao');

-- ---------- rate limit ----------
select is((select count(*)::int from unnest(array[
  'request_payout','cancel_payout_request','onboard_booster','confirm_order_completion','reserve_duo_account',
  'booster_heartbeat','release_duo_account_reservation','set_duo_own_riot_id','clear_duo_own_riot_id',
  'update_duo_account_rank','update_booster_professional_profile','update_my_display_name',
  'set_order_coaching_topic_done','ensure_profile_exists','mark_order_chat_read','update_my_cpf','accept_legal']) f
  where exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f
                  and pg_get_functiondef(p.oid) like '%check_own_write_rate_limit%')),
          17, 'RPCs de escrita do client tem rate limit');

-- ---------- handle_new_user ----------
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
          'customer', 'signup ignora raw_user_meta_data.role');

insert into public.notifications (user_id, type, title, body)
values ('00000000-0000-0000-0000-0000000000b1', 'test', 't', 'b');

-- ---------- como usuario autenticado (booster) ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

select throws_ok($$update public.booster_profiles set is_top3 = true where user_id = auth.uid()$$,
  '42501', null, 'booster nao se promove a top3 pelo REST');
select throws_ok($$update public.booster_profiles set suspended_until = null where user_id = auth.uid()$$,
  '42501', null, 'booster nao desfaz suspensao pelo REST');
select throws_ok($$update public.profiles set role = 'admin' where id = auth.uid()$$,
  '42501', null, 'usuario nao muda a propria role');
select lives_ok($$update public.profiles set avatar_url = 'https://x/y.png' where id = auth.uid()$$,
  'usuario troca o proprio avatar');
select throws_ok($$update public.profiles set terms_accepted_at = now() where id = auth.uid()$$,
  '42501', null, 'aceite legal so por RPC');

select is((public.accept_legal('1999-01-01')->>'success')::boolean, false, 'accept_legal rejeita versao desconhecida');
select is((public.accept_legal(public.current_legal_version())->>'success')::boolean, true, 'accept_legal grava com a versao vigente');
select ok((select terms_accepted_at from public.profiles where id = auth.uid()) > now() - interval '1 minute',
  'accept_legal usa o relogio do servidor');

select is((public.update_my_cpf('11111111111')->>'error'), 'invalid_cpf', 'CPF com digito verificador invalido e rejeitado');
select is((public.update_my_cpf('529.982.247-25')->>'success')::boolean, true, 'CPF valido e aceito (mascara removida)');

select is((public.onboard_booster('Hack', 'bio', '{"tier":"challenger"}', 'https://op.gg/y', 1, 4, 'Outro Nome', '52998224725', array['mon'])->>'error'),
          'application_not_editable', 'booster aprovado nao sobrescreve a propria candidatura');

select lives_ok($$update public.notifications set is_read = true where user_id = auth.uid()$$,
  'usuario marca a propria notificacao como lida (trigger roda sem EXECUTE)');
select throws_ok($$update public.notifications set title = 'x' where user_id = auth.uid()$$,
  '42501', null, 'usuario nao edita o texto da notificacao');
select lives_ok($$insert into public.booster_services (booster_id, title, description, tempo, price, lanes, specialties)
  values (auth.uid(), 'Pacote', 'desc', '1h', 50, array['mid'], array['macro'])$$,
  'booster aprovado cria pacote de coaching');

select is((public.update_my_cpf('５２９９８２２４７２５')->>'error'), 'invalid_cpf', 'CPF com digitos unicode e rejeitado sem erro');
select throws_ok($$insert into public.reviews (order_id, customer_id, rating, is_moderated, admin_note)
  values (gen_random_uuid(), auth.uid(), 5, true, 'x')$$, '42501', null, 'cliente nao grava colunas de moderacao em reviews');

reset role;
-- rejeitado reenvia a candidatura
set local session_replication_role = replica;
update public.booster_profiles set status = 'rejected' where user_id = '00000000-0000-0000-0000-0000000000b1';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((public.onboard_booster('Boost', 'bio', '{"tier":"challenger"}', 'https://op.gg/y', 1, 4, 'Booster Teste', '52998224725', array['mon'])->>'success')::boolean,
          true, 'rejeitado reenvia a candidatura');
reset role;
select is((select status::text from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'pending', 'candidatura reenviada volta para pending');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT') and not has_table_privilege('anon', 'public.audit_logs', 'SELECT')
      and has_table_privilege('anon', 'public.games', 'SELECT'), 'anon so le o catalogo publico');
set local role anon;
select throws_ok($$select customer_id from public.reviews$$, '42501', null, 'anon nao le customer_id de reviews');
select lives_ok($$select id, rating, content, booster_id from public.reviews where is_public$$, 'anon le as colunas publicas de reviews');
reset role;
select * from finish();
rollback;
