-- Regras de negocio que antes eram "testes de texto" sobre migrations antigas, agora executadas contra o banco.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';
update public.profiles set role = 'booster' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.booster_profiles (user_id, display_name, status, full_name, email, cpf, peak_rank, opgg_link, hours_per_day_min, hours_per_day_max, available_days) values
  ('00000000-0000-0000-0000-0000000000b1', 'B1', 'approved', 'B Um', 'b1@t.local', '52998224725', '{"tier":"challenger"}', 'https://op.gg/1', 1, 4, array['mon']),
  ('00000000-0000-0000-0000-0000000000b2', 'B2', 'approved', 'B Dois', 'b2@t.local', '11144477735', '{"tier":"challenger"}', 'https://op.gg/2', 1, 4, array['mon']);

create function pg_temp.mk(p_status public.order_status, p_type public.service_type default 'win_boost', p_customer uuid default '00000000-0000-0000-0000-0000000000c1',
                           p_booster uuid default null, p_synced boolean default true) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (customer_id, service_id, game_id, server, base_price, total_price, service_type, boost_mode,
         current_rank, wins_purchased, win_package, status, payment_status, assigned_booster_id, last_match_synced_at, match_sync_started_at,
         clash_tier, clash_day)
  values (p_customer, 's', 'g', 'br', 10, 10, p_type, 'solo',
          case when p_type in ('clash', 'coaching') then null else '{"tier":"gold","division":"IV"}'::jsonb end,
          case when p_type = 'win_boost' then 3 end, case when p_type = 'win_boost' then 3 end,
          p_status, 'paid', p_booster, case when p_synced then now() end, now(),
          case when p_type = 'clash' then 'tier_2'::public.clash_tier end, case when p_type = 'clash' then 'saturday'::public.clash_day end)
  returning id into v;
  return v;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);

-- ---------- teto de 1 Clash ativo por cliente ----------
create temp table clash1 on commit drop as select pg_temp.mk('awaiting_assignment', 'clash') as id;
select throws_ok($$select pg_temp.mk('awaiting_assignment', 'clash')$$, 'P0001', 'active_clash_order_exists', 'segundo Clash ativo do mesmo cliente e recusado');
select lives_ok($$select pg_temp.mk('awaiting_assignment', 'clash', '00000000-0000-0000-0000-0000000000c2')$$, 'outro cliente pode ter o seu Clash');
select lives_ok($$select pg_temp.mk('awaiting_assignment', 'win_boost')$$, 'pedido que nao e Clash nao conta no teto');
update public.orders set status = 'completed', assigned_booster_id = '00000000-0000-0000-0000-0000000000b1' where id = (select id from clash1);
select lives_ok($$select pg_temp.mk('awaiting_assignment', 'clash')$$, 'Clash concluido libera um novo');

-- ---------- coaching: cliente troca de coach sem sync; os demais exigem sync ----------
create temp table co on commit drop as select pg_temp.mk('in_progress', 'coaching', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', false) as id;
create temp table wb on commit drop as select pg_temp.mk('in_progress', 'win_boost', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', false) as id;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((public.request_customer_order_drop((select id from co), 'quero trocar de coach')->>'success')::boolean, true, 'coaching: cliente pede troca mesmo sem sync de partidas');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is((public.request_customer_order_drop((select id from wb), 'quero trocar de booster')->>'error'), 'sync_required_before_drop', 'outros servicos continuam exigindo o sync antes da troca');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((public.request_customer_order_drop((select id from wb), 'tentando trocar pedido alheio')->>'error'), 'unauthorized', 'so o cliente dono pede a troca');

-- ---------- apply_order_drop limpa duo_own_riot_id e fecha o progresso ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', true);
create temp table duo1 on commit drop as select pg_temp.mk('drop_requested', 'win_boost', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2') as id;
update public.orders set duo_own_riot_id = 'Amigo#BR1' where id = (select id from duo1);
select public.apply_order_drop((select id from duo1), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'drop normal', 'admin');
select is((select duo_own_riot_id from public.orders where id = (select id from duo1)), null::text, 'drop normal limpa o Riot ID proprio do duo');
create temp table duo2 on commit drop as select pg_temp.mk('drop_requested', 'win_boost', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2') as id;
update public.orders set duo_own_riot_id = 'Amigo#BR1', drop_count = 2 where id = (select id from duo2);
select public.apply_order_drop((select id from duo2), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', '3o drop', 'admin');
select is((select status::text from public.orders where id = (select id from duo2)), 'under_review', '3o drop vai para analise');

-- payout nunca passa do comprado (5 vitorias jogadas de 3 compradas)
create temp table clamp on commit drop as select pg_temp.mk('drop_requested', 'win_boost', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2') as id;
update public.orders set wins_played = 5, losses_played = 0 where id = (select id from clamp);
select public.apply_order_drop((select id from clamp), 'drop_requested', '00000000-0000-0000-0000-0000000000ad', 'passou do comprado', 'admin');
select is((select status::text from public.orders where id = (select id from clamp)), 'completed', 'vitorias alem do comprado concluem o pedido (nao reabrem)');
select ok((select coalesce(sum(amount), 0) from public.booster_ledger_entries where order_id = (select id from clamp) and entry_type = 'commission_credit') <= 10 * 0.6,
  'credito ao booster limitado ao preco do pedido (nao paga vitorias nao compradas)');

-- ---------- saque aprovado ainda pode ser rejeitado, devolvendo a reserva ----------
insert into public.payout_requests (id, booster_id, amount, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 100, 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', 100, 'approved');
update public.payout_requests set status = 'paid', proof_url = '00000000-0000-0000-0000-0000000000f2/comprovante.png', paid_at = now(), paid_by = '00000000-0000-0000-0000-0000000000ad' where id = '00000000-0000-0000-0000-0000000000f2';
select is((public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f1', 'rejected', 'dados bancarios invalidos')->>'success')::boolean, true, 'admin rejeita um saque ja aprovado');
select is((select amount from public.booster_ledger_entries where payout_request_id = '00000000-0000-0000-0000-0000000000f1' and entry_type = 'payout_release'), 100::numeric, '...e a reserva volta ao saldo do booster');
select is((public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f2', 'rejected', 'tarde demais')->>'error'), 'invalid_status', 'saque ja pago nao pode ser rejeitado');
select is((public.admin_review_payout_request('00000000-0000-0000-0000-0000000000f1', 'approved', 'voltando')->>'error'), 'invalid_status', 'saque rejeitado nao volta para aprovado');

-- ---------- pool: pedido reatribuido volta ao booster que dropou; aos demais continua escondido ----------
create temp table pool on commit drop as select pg_temp.mk('awaiting_assignment', 'win_boost') as id;
update public.orders set credentials_set = true, game_credentials = 'x', credential_expires_at = now() + interval '1 hour' where id = (select id from pool);
insert into public.order_drop_requests (order_id, booster_id, reason, wins_at_request, losses_at_request, penalty_pct, penalty_amount, requested_by_role, status_at_request, status)
  values ((select id from pool), '00000000-0000-0000-0000-0000000000b1', 'larguei', 0, 0, 0, 0, 'booster', 'in_progress', 'approved');
select set_config('t.pool', (select id::text from pool), false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.available_boost_orders where id = current_setting('t.pool')::uuid), 0, 'quem dropou o pedido nao o ve de novo no pool');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.available_boost_orders where id = current_setting('t.pool')::uuid), 1, 'outro booster aprovado ve o pedido no pool');
reset role;
update public.orders set preferred_booster_id = '00000000-0000-0000-0000-0000000000b1', exclusive_until = now() + interval '9 hours' where id = (select id from pool);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.available_boost_orders where id = current_setting('t.pool')::uuid), 1, 'reatribuido pelo admin a quem dropou: ele ve o pedido');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.available_boost_orders where id = current_setting('t.pool')::uuid), 0, 'reserva exclusiva esconde o pedido dos demais');
reset role;

-- ---------- pedido que exige credenciais so aparece no pool depois de enviadas ----------
create temp table nocred on commit drop as select pg_temp.mk('awaiting_assignment', 'win_boost') as id;
select set_config('t.nocred', (select id::text from nocred), false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.available_boost_orders where id = current_setting('t.nocred')::uuid), 0, 'sem credenciais enviadas o pedido nao entra no pool');
reset role;

-- ---------- contas duo: booster so ve contas ativas, com credenciais e rank valido (o CHECK impede rank invalido em conta ativa) ----------
insert into public.duo_accounts (id, label, riot_id, current_rank, encrypted_credentials, is_active) values
  ('00000000-0000-0000-0000-00000000da01', 'valida', 'Conta#BR1', '{"tier":"gold","division":"IV"}', 'x', true),
  ('00000000-0000-0000-0000-00000000da02', 'inativa', 'Conta#BR2', '{"tier":"gold","division":"IV"}', 'x', false),
  ('00000000-0000-0000-0000-00000000da03', 'sem-credencial', 'Conta#BR3', '{"tier":"gold","division":"IV"}', null, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select jsonb_array_length(public.list_duo_accounts()->'accounts')), 1, 'booster so lista conta duo ativa e com credenciais');
select is((public.list_duo_accounts()->'accounts'->0->>'riot_id'), 'Conta#BR1', '...e recebe o riot_id da conta');

select * from finish();
rollback;
