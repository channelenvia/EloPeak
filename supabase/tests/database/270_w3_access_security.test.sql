-- W-3: H-2 rate limit nao chamavel pelo client; H-14 RPCs admin com rate limit; H-3 pedido proprio;
-- H-4 service_role expulsa booster; M-17 reviews sem admin_note; L-2 oraculo de booster aprovado; L-4 stats so de aprovados.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
update public.profiles set terms_accepted_at = now(), privacy_accepted_at = now(), legal_version = public.current_legal_version()
  where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'pending', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

-- ---------- H-2 ----------
select ok(not has_function_privilege('authenticated', 'public.check_own_write_rate_limit(text,integer,integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.check_own_write_rate_limit(text,integer,integer)', 'EXECUTE'),
  'H-2: client nao chama check_own_write_rate_limit');

-- ---------- H-14 ----------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('admin_review_payout_request','admin_mark_payout_paid','admin_confirm_manual_refund',
                            'admin_cancel_manual_refund','admin_set_pending_review_lock','admin_set_order_chat_lock','cancel_payout_request')
            and pg_get_functiondef(oid) ilike '%check_own_write_rate_limit%'), 7, 'H-14: as 7 RPCs financeiras/admin passam pelo rate limit');

-- ---------- H-3 ----------
insert into public.orders (id, customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
       current_rank, wins_purchased, win_package, status, payment_status, credentials_set, game_credentials, credential_expires_at)
values ('00000000-0000-0000-0000-00000000f3a1', '00000000-0000-0000-0000-0000000000b1', 's', 'g', 'br', 10, 10, 'win_boost', 'solo',
        '{"tier":"gold","division":"IV"}', 3, 3, 'awaiting_assignment', 'paid', true, 'x', now() + interval '1 hour');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.available_boost_orders where id = '00000000-0000-0000-0000-00000000f3a1'), 0, 'H-3: pedido proprio nao aparece na fila');
reset role;
create temp table ch on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000f3a1', 'Kaisa', 'kaisa', 42) as id;
select public.verify_accept_challenge((select id from ch), '00000000-0000-0000-0000-0000000000b1', 'kaisa');
select is(public.accept_boost_order('00000000-0000-0000-0000-00000000f3a1', '00000000-0000-0000-0000-0000000000b1', (select id from ch))->>'error', 'own_order', 'H-3: booster nao aceita o proprio pedido');

-- ---------- H-4 (sem JWT de usuario = service_role/cron) ----------
select set_config('request.jwt.claims', '', true);
update public.booster_profiles set status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000000b1';
select is((public.expel_booster((select id from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'fraude comprovada no caso', '00000000-0000-0000-0000-0000000000ad')->>'success')::boolean, true, 'H-4: expel_booster sem JWT conclui');
select is((select status::text from public.booster_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'removed', 'H-4: booster fica removed');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$update public.booster_profiles set status = 'approved' where user_id = '00000000-0000-0000-0000-0000000000b2'$$,
  null, 'only admins can change booster application status', 'H-4: usuario comum segue barrado pelo trigger');

-- ---------- M-17 ----------
select ok(not has_column_privilege('authenticated', 'public.reviews', 'admin_note', 'SELECT')
      and not has_column_privilege('authenticated', 'public.reviews', 'is_moderated', 'SELECT')
      and has_column_privilege('authenticated', 'public.reviews', 'rating', 'SELECT'),
  'M-17: authenticated nao le admin_note/is_moderated');
select throws_ok($$select * from public.admin_list_reviews(10)$$, '42501', 'unauthorized', 'M-17: admin_list_reviews so para admin');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
select lives_ok($$select * from public.admin_list_reviews(10)$$, 'M-17: admin lista a moderacao');

-- ---------- L-2 ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.can_booster_accept_order('00000000-0000-0000-0000-0000000000b2', 'solo')$$, null, 'forbidden', 'L-2: terceiro nao usa a RPC como oraculo (aprovado ou nao)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
select is((public.can_booster_accept_order('00000000-0000-0000-0000-0000000000b2', 'solo')->>'reason'), 'booster_not_approved', 'L-2: admin ainda consulta (b2 pendente)');

-- ---------- L-4 ----------
insert into public.booster_performance_segments (booster_id, service_type, rank_bucket, account_type, queue_type, total_matches, wins, losses,
       adjusted_win_rate, normalized_kda, review_count, performance_score, score_version, mvp_count, completed_orders)
  values ('00000000-0000-0000-0000-0000000000b2', 'elo_boost', 'gold', 'solo', 'solo_duo', 5, 3, 2, 0.6, 0.5, 0, 50, 1, 0, 0);
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from public.booster_performance_segments where booster_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'L-4: anon nao ve stats de booster nao aprovado');
reset role;
select is((select count(*)::int from public.booster_performance_segments where booster_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'L-4: a linha existe (controle)');
select ok(has_function_privilege('anon', 'public.is_approved_booster_user(uuid)', 'EXECUTE'), 'L-4: helper acessivel para a policy publica');

select * from finish();
rollback;
