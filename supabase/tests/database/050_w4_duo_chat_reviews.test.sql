begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days)
values ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
       ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

create function pg_temp.mk(p_status public.order_status, p_mode text default 'solo', p_type public.service_type default 'win_boost', p_drops int default 0) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, drop_count, match_sync_started_at, last_match_synced_at)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, p_type, p_mode,
          '{"tier":"gold","division":"IV"}', case when p_type = 'win_boost' then 3 end, case when p_type = 'win_boost' then 3 end,
          p_status, 'paid', '00000000-0000-0000-0000-0000000000b1', p_drops, now(), now())
  returning id into v;
  insert into public.order_booster_assignments (order_id, booster_id) values (v, '00000000-0000-0000-0000-0000000000b1');
  return v;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');

-- ---------- H-17: reserva duo ----------
insert into public.duo_accounts (id, label, current_rank) values
  ('00000000-0000-0000-0000-00000000da01', 'A', '{"tier":"gold","division":"IV"}'),
  ('00000000-0000-0000-0000-00000000da02', 'B', '{"tier":"gold","division":"IV"}'),
  ('00000000-0000-0000-0000-00000000da03', 'C', '{"tier":"gold","division":"IV"}');
create temp table d1 on commit drop as select pg_temp.mk('in_progress', 'duo') as id, pg_temp.mk('in_progress', 'duo') as other;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((public.reserve_duo_account((select id from d1), '00000000-0000-0000-0000-00000000da01')->>'success')::boolean, true, 'booster reserva a conta duo A');
select is((public.reserve_duo_account((select other from d1), '00000000-0000-0000-0000-00000000da02')->>'success')::boolean, true, 'outro pedido reserva a conta B');
select is((public.reserve_duo_account((select id from d1), '00000000-0000-0000-0000-00000000da02')->>'error'), 'account_unavailable', 'troca para conta ocupada falha...');
select is((select reserved_order_id from public.duo_accounts where id = '00000000-0000-0000-0000-00000000da01'), (select id from d1), '...e a conta antiga continua reservada (troca atomica)');
select is((public.reserve_duo_account((select id from d1), '00000000-0000-0000-0000-00000000da03')->>'success')::boolean, true, 'troca para conta livre funciona');
select is((select count(*)::int from public.duo_account_reservations where account_id = '00000000-0000-0000-0000-00000000da01' and released_at is null), 0, 'reserva da conta antiga foi fechada');

-- drop limpa a reserva e fecha o registro: a conta pode ser reservada de novo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
update public.orders set status = 'drop_requested' where id = (select id from d1);
select public.apply_order_drop((select id from d1), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'drop duo', 'admin');
select is((select count(*)::int from public.duo_account_reservations where account_id = '00000000-0000-0000-0000-00000000da03' and released_at is null), 0, 'drop fecha o registro de reserva duo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((public.reserve_duo_account((select other from d1), '00000000-0000-0000-0000-00000000da03')->>'success')::boolean, true, 'conta liberada pelo drop pode ser reservada por outro pedido');

-- ---------- H-18: reatribuir no limite de drops nao comita nada ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table lim on commit drop as select pg_temp.mk('in_progress', 'solo', 'win_boost', 2) as id;
select is((public.admin_reassign_booster((select id from lim), '00000000-0000-0000-0000-0000000000b2', 'reatribuicao no limite de drops')->>'error'), 'drop_limit_reached', 'reatribuir com 2 drops devolve erro...');
select is((select status::text from public.orders where id = (select id from lim)), 'in_progress', '...sem alterar o pedido');

-- ---------- H-21: chat fecha em pedido cancelado; mencoes limitadas ----------
create temp table ch on commit drop as select pg_temp.mk('in_progress') as id;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.send_order_message((select id from ch), 'oi, tudo bem?', array['00000000-0000-0000-0000-0000000000ad']::uuid[])->>'success')::boolean, true, 'cliente manda mensagem em pedido ativo');
select public.send_order_message((select id from ch), 'oi de novo', array['00000000-0000-0000-0000-0000000000ad']::uuid[]);
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000ad' and type = 'chat_mention'), 1, 'mencao repetida em 5 min gera uma notificacao so');
select is((select body from public.notifications where user_id = '00000000-0000-0000-0000-0000000000ad' and type = 'chat_mention'), 'Você foi mencionado no chat de um pedido.', 'notificacao nao copia o texto da mensagem');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
update public.orders set status = 'canceled' where id = (select id from ch);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.send_order_message((select id from ch), 'ainda aqui?')->>'code'), 'chat_closed', 'chat fechado depois de cancelado');
select is((public.get_order_chat((select id from ch))->>'can_send')::boolean, false, 'get_order_chat: can_send false');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
select is((public.send_order_message((select id from ch), 'nota do admin')->>'success')::boolean, true, 'admin ainda pode escrever');

-- ---------- H-20: moderacao de reviews ----------
create temp table rv on commit drop as select pg_temp.mk('completed') as id;
insert into public.reviews (order_id, customer_id, booster_id, rating, content)
  values ((select id from rv), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1, 'texto ofensivo');
select is((public.admin_moderate_review((select id from public.reviews limit 1), false, 'ofensivo')->>'success')::boolean, true, 'admin oculta review');
select is((select is_public from public.reviews limit 1), false, 'review fica fora da pagina publica');
select is((select count(*)::int from public.audit_logs where action = 'review.moderated'), 1, 'moderacao auditada');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.admin_moderate_review((select id from public.reviews limit 1), true)->>'error'), 'unauthorized', 'cliente nao modera');

-- ---------- H-38: coaching dropado nao fica orfao ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table co on commit drop as select pg_temp.mk('drop_requested', 'solo', 'coaching') as id;
select public.apply_order_drop((select id from co), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'coach largou', 'booster', 0);
select is((select status::text from public.orders where id = (select id from co)), 'under_review', 'coaching dropado vai para analise do admin');
select ok(exists (select 1 from public.notifications where type = 'coaching_needs_new_coach'), 'admin e avisado para escolher novo coach');

-- coaching em andamento reatribuido pelo admin volta a fila do coach escolhido
create temp table co2 on commit drop as select pg_temp.mk('in_progress', 'solo', 'coaching') as id;
select is((public.admin_reassign_booster((select id from co2), '00000000-0000-0000-0000-0000000000b2', 'novo coach escolhido pelo admin')->>'success')::boolean, true, 'admin reatribui coaching em andamento a outro coach');
select is((select status::text from public.orders where id = (select id from co2)), 'awaiting_assignment', 'coaching reatribuido volta para a fila (nao fica em analise)');

-- cap real de 3 mencoes por mensagem
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000a00' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm' || g || '@t.local', '{}' from generate_series(1, 5) g;
update public.profiles set role = 'admin' where email like 'adm%@t.local';
create temp table mn on commit drop as select pg_temp.mk('in_progress') as id;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.send_order_message((select id from mn), 'chamando todos os admins', (select array_agg(id) from public.profiles where role = 'admin' and email like 'adm%@t.local'));
select ok((select count(*)::int from public.notifications where type = 'chat_mention' and (data->>'order_id')::uuid = (select id from mn)) <= 3, 'no maximo 3 mencoes por mensagem');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');

-- ---------- M-12: pedido de drop pendente nao fica orfao ----------
create temp table orf on commit drop as select pg_temp.mk('drop_requested') as id;
insert into public.order_drop_requests (order_id, booster_id, reason, wins_at_request, losses_at_request, penalty_pct, penalty_amount, requested_by_role, status_at_request)
  values ((select id from orf), '00000000-0000-0000-0000-0000000000b1', 'quero largar', 0, 0, 0, 0, 'booster', 'in_progress');
update public.orders set status = 'in_progress' where id = (select id from orf);
select is((select status from public.order_drop_requests where order_id = (select id from orf)), 'rejected', 'pedido de drop pendente e encerrado quando o pedido sai de drop_requested');

-- ---------- H-37 / M-16: manutencao ----------
insert into public.notifications (user_id, type, title, body, is_read, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', 't', 't', 'velha lida', true, now() - interval '90 days'),
  ('00000000-0000-0000-0000-0000000000c1', 't', 't', 'velha nao lida', false, now() - interval '90 days');
select public.prune_old_data();
select is((select count(*)::int from public.notifications where body = 'velha lida'), 0, 'prune remove notificacao lida antiga');
select is((select count(*)::int from public.notifications where body = 'velha nao lida'), 1, 'prune mantem notificacao nao lida');

select * from finish();
rollback;
