-- W-2: H-1 liberar analise vinda de drop_requested; M-1 refund pendente nao volta ao pool;
-- H-11 accept pelo pool limpa reassigned_by_admin; H-12 reassign nao segue apos o drop concluir o pedido.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

create function pg_temp.mk(p_status text, p_booster uuid, p_type text default 'win_boost') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, credentials_set)
  values ('00000000-0000-0000-0000-0000000000c1', 's', 'g', 'br', 10, 10, p_type::public.service_type, 'solo',
          '{"tier":"gold","division":"IV"}', case when p_type = 'win_boost' then 3 end, case when p_type = 'win_boost' then 3 end,
          p_status::public.order_status, 'paid', p_booster, false)
  returning id into v;
  if p_booster is not null then
    insert into public.order_booster_assignments (order_id, booster_id) values (v, p_booster);
  end if;
  return v;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');

-- ---------- H-1 ----------
create temp table h1 on commit drop as select pg_temp.mk('drop_requested', '00000000-0000-0000-0000-0000000000b1') as id;
insert into public.order_drop_requests (order_id, booster_id, reason, status, status_at_request)
  values ((select id from h1), '00000000-0000-0000-0000-0000000000b1', 'quero sair', 'pending', 'in_progress');
select is((public.admin_flag_order_under_review((select id from h1), 'analise manual do pedido')->>'success')::boolean, true, 'H-1: flag em analise a partir de drop_requested');
select is((public.admin_set_pending_review_lock((select id from h1), false)->>'success')::boolean, true, 'H-1: liberar a analise');
select is((select status::text from public.orders where id = (select id from h1)), 'in_progress', 'H-1: nao volta a drop_requested sem solicitacao pendente');

-- ---------- M-1 ----------
create temp table m1 on commit drop as select pg_temp.mk('under_review', null) as id;
insert into public.refunds (order_id, amount, reason, initiated_by, status, is_manual)
  values ((select id from m1), 5, 'reembolso manual', '00000000-0000-0000-0000-0000000000ad', 'pending', true);
select is(public.admin_set_pending_review_lock((select id from m1), false)->>'error', 'refund_pending', 'M-1: refund pendente impede voltar ao pool');
select is((select status::text from public.orders where id = (select id from m1)), 'under_review', 'M-1: pedido segue em analise');
select is(public.admin_assign_pending_review_order((select id from m1), '00000000-0000-0000-0000-0000000000b2', 'reatribuir')->>'error', 'refund_pending', 'M-1: atribuir direto tambem respeita o refund pendente');
update public.refunds set status = 'succeeded' where order_id = (select id from m1);
create temp table m1b on commit drop as select pg_temp.mk('pending_review', null) as id;
update public.orders set admin_review_locked = true where id = (select id from m1b);
insert into public.refunds (order_id, amount, reason, initiated_by, status, is_manual)
  values ((select id from m1b), 5, 'reembolso manual', '00000000-0000-0000-0000-0000000000ad', 'pending', true);
select is(public.admin_set_pending_review_lock((select id from m1b), false)->>'error', 'refund_pending', 'M-1: pending_review com refund pendente nao "libera" so no audit');
select is((select admin_review_locked from public.orders where id = (select id from m1b)), true, 'M-1: trava segue ativa');
create temp table m1c on commit drop as select pg_temp.mk('under_review', '00000000-0000-0000-0000-0000000000b1') as id;
update public.orders set under_review_from_status = 'in_progress', under_review_started_at = now() where id = (select id from m1c);
insert into public.refunds (order_id, amount, reason, initiated_by, status, is_manual)
  values ((select id from m1c), 5, 'reembolso manual', '00000000-0000-0000-0000-0000000000ad', 'pending', true);
select is((public.admin_set_pending_review_lock((select id from m1c), false)->>'success')::boolean, true, 'M-1: com booster mantido a liberacao segue permitida');
select is((public.admin_set_pending_review_lock((select id from m1), false)->>'success')::boolean, true, 'M-1: sem refund pendente libera');

-- ---------- H-11 ----------
create temp table h11 on commit drop as select pg_temp.mk('awaiting_assignment', null) as id;
update public.orders set reassigned_by_admin = true, preferred_booster_id = '00000000-0000-0000-0000-0000000000b1',
       exclusive_until = now() - interval '1 hour', credentials_set = true, game_credentials = 'x',
       credential_expires_at = now() + interval '1 hour'
 where id = (select id from h11);
create temp table ch on commit drop as select public.issue_accept_challenge('00000000-0000-0000-0000-0000000000b2', (select id from h11), 'Kaisa', 'kaisa', 42) as id;
select public.verify_accept_challenge((select id from ch), '00000000-0000-0000-0000-0000000000b2', 'kaisa');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is((public.accept_boost_order((select id from h11), '00000000-0000-0000-0000-0000000000b2', (select id from ch))->>'success')::boolean, true, 'H-11: outro booster aceita pelo pool depois da exclusividade');
select is((select reassigned_by_admin from public.orders where id = (select id from h11)), false, 'H-11: isencao de slot da reatribuicao e limpa');

-- ---------- H-12 ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table h12 on commit drop as select pg_temp.mk('in_progress', '00000000-0000-0000-0000-0000000000b1', 'coaching') as id;
create temp table h12r on commit drop as
  select public.admin_reassign_booster((select id from h12), '00000000-0000-0000-0000-0000000000b2', 'reatribuir coaching concluido', 100) as r;
select ok((select (r->>'completed')::boolean and (select status::text from public.orders where id = (select id from h12)) = 'completed'
           and (select preferred_booster_id from public.orders where id = (select id from h12)) is null from h12r),
  'H-12: coaching com 100% conclui e nao e reatribuido');

select * from finish();
rollback;
