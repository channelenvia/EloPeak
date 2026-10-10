-- W1: acesso e seguranca do banco (C-02, C-04, H-01, H-02, H-19, H-36, H-40, M-01, M-02, M-03, M-04, M-06, M-10, M-50).
-- Regra daqui em diante: objetos novos NAO nascem com grant para anon/authenticated
-- (default privileges revogadas abaixo); cada migration concede explicitamente o que o client usa.
set search_path = public, extensions;

-- ===== M-01 / C-02: pool de jobs sem riot_id nem dados de atribuicao, somente leitura =====
drop view public.available_boost_orders;
create view public.available_boost_orders with (security_barrier = true) as
 SELECT id, service_id, game_id, status, queue_type, boost_mode, server, current_rank, target_rank,
    wins_purchased, sessions_purchased, win_package, extras, total_price, estimated_hours,
    wins_played, losses_played, current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
    created_at, updated_at, preferred_booster_id, exclusive_until, drop_count, rank_before_last_drop,
    last_dropped_at, service_type, clash_tier, clash_day, customer_lanes, booster_service_id, reassigned_by_admin
   FROM orders
  WHERE status = 'awaiting_assignment'::order_status AND assigned_booster_id IS NULL AND is_approved_booster() AND (NOT order_requires_access_token(service_type, boost_mode) OR credentials_set = true) AND
        CASE
            WHEN service_type = 'coaching'::service_type THEN preferred_booster_id = auth.uid()
            ELSE preferred_booster_id IS NULL OR exclusive_until IS NULL OR exclusive_until <= now() OR preferred_booster_id = auth.uid()
        END AND (preferred_booster_id = auth.uid() OR NOT (EXISTS ( SELECT 1
           FROM order_drop_requests dr
          WHERE dr.order_id = orders.id AND dr.booster_id = auth.uid() AND dr.status = 'approved'::text)));

-- ===== C-02 / H-01 / H-02: grants =====
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
grant select on public.public_booster_profiles to anon, authenticated;
grant select on public.available_boost_orders to authenticated;

-- O que o front ainda escreve direto (tudo mais passa por RPC ou service_role).
grant update (avatar_url) on public.profiles to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant insert (order_id, customer_id, booster_id, rating, content) on public.reviews to authenticated;
grant insert, update on public.booster_services to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- ===== H-02: admin nao escreve dinheiro/historico direto pelo REST =====
drop policy if exists orders_update on public.orders;
drop policy if exists payments_admin_insert on public.payments;
drop policy if exists payments_admin_update on public.payments;
drop policy if exists payments_admin_delete on public.payments;
drop policy if exists payout_records_admin_update on public.payout_records;
drop policy if exists order_status_history_insert on public.order_status_history;
drop policy if exists audit_logs_insert on public.audit_logs;

-- ===== M-02: funcoes de trigger e RPCs internas nao sao chamaveis pelo client =====
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
revoke execute on function public.onboard_booster(text,text,jsonb,text,integer,integer,text,text,text[]) from public, anon;
revoke execute on function public.update_booster_professional_profile(text,text,text,text,boolean,text[],integer,integer) from public, anon;
revoke execute on function public.can_booster_accept_order(uuid,text,text) from public, anon;
revoke execute on function public.order_drop_completion_pct(uuid) from public, anon;
revoke execute on function public.current_user_role() from public, anon;

-- ===== M-04: anon le so as colunas publicas de reviews =====
revoke select on public.reviews from anon;
grant select (id, booster_id, rating, content, created_at, is_public) on public.reviews to anon;

-- ===== M-50: so booster aprovado cadastra/edita pacote =====
drop policy if exists booster_services_owner_insert on public.booster_services;
drop policy if exists booster_services_owner_update on public.booster_services;
create policy booster_services_owner_insert on public.booster_services for insert to authenticated
  with check (booster_id = auth.uid() and public.is_approved_booster(auth.uid()));
create policy booster_services_owner_update on public.booster_services for update to authenticated
  using (booster_id = auth.uid())
  with check (booster_id = auth.uid());

-- ===== M-06: comprovantes de saque =====
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'application/pdf']
 where id = 'payout-proofs';

-- ===== M-03: signup nunca cria booster/admin =====
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email      text;
  v_username   text;
  v_discord_id text;
begin
  v_email := coalesce(new.email, new.raw_user_meta_data->>'email', new.id::text || '@oauth.local');

  v_username := coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1),
    'user'
  );
  v_username := regexp_replace(v_username, '#\d+$', '');
  v_username := left(regexp_replace(v_username, '[^a-zA-Z0-9_]', '_', 'g'), 30);
  if v_username = '' then v_username := 'user'; end if;

  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 22) || '_' || left(new.id::text, 7);
  end if;

  v_discord_id := coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub');

  insert into public.profiles(id, email, role, username, discord_id)
  values (new.id, v_email, 'customer', v_username, v_discord_id)
  on conflict (id) do update
    set discord_id = coalesce(excluded.discord_id, profiles.discord_id);

  insert into public.customer_profiles(user_id) values (new.id) on conflict (user_id) do nothing;

  return new;
end;
$function$;

-- ===== C-04: guard de colunas privilegiadas de booster_profiles =====
-- Defesa em profundidade (o REST ja nao tem UPDATE): INVOKER, para current_user
-- ser o papel da API; RPCs DEFINER rodam como dono e passam.
create or replace function public.prevent_non_admin_booster_privileged_column_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if new.is_top3 is distinct from old.is_top3
     or new.total_earnings is distinct from old.total_earnings
     or new.rating is distinct from old.rating
     or new.rating_count is distinct from old.rating_count
     or new.suspended_until is distinct from old.suspended_until
     or new.verified_at is distinct from old.verified_at
     or new.total_completed is distinct from old.total_completed
     or new.cpf is distinct from old.cpf
     or new.full_name is distinct from old.full_name
     or new.email is distinct from old.email
     or new.peak_rank is distinct from old.peak_rank
  then
    raise exception 'only admins can change privileged booster_profiles columns' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ===== H-19: CPF, nome e aceite legal so por RPC =====
create or replace function public.current_legal_version()
 returns text language sql immutable set search_path to 'public'
as $$ select '2026-09-06'::text $$;

create or replace function public.is_valid_cpf(p_cpf text)
 returns boolean language plpgsql immutable set search_path to 'public'
as $function$
declare
  d int[];
  s int;
  i int;
  k int;
begin
  if p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^([0-9])\1{10}$' then return false; end if;
  for i in 1..11 loop d[i] := substr(p_cpf, i, 1)::int; end loop;
  for k in 9..10 loop
    s := 0;
    for i in 1..k loop s := s + d[i] * (k + 2 - i); end loop;
    if ((s * 10) % 11) % 10 <> d[k + 1] then return false; end if;
  end loop;
  return true;
end;
$function$;

create or replace function public.accept_legal(p_version text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_now timestamptz := now();
begin
  if not public.check_own_write_rate_limit('accept_legal', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if p_version is distinct from public.current_legal_version() then
    return jsonb_build_object('success', false, 'error', 'invalid_legal_version');
  end if;
  update public.profiles
     set terms_accepted_at = v_now, privacy_accepted_at = v_now, legal_version = p_version, updated_at = v_now
   where id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'profile_not_found');
  end if;
  return jsonb_build_object('success', true, 'accepted_at', v_now, 'legal_version', p_version);
end;
$function$;

create or replace function public.update_my_cpf(p_cpf text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_old text;
begin
  if not public.check_own_write_rate_limit('update_my_cpf', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.is_valid_cpf(v_cpf) then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  select cpf into v_old from public.booster_profiles where user_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  update public.booster_profiles set cpf = v_cpf, updated_at = now() where user_id = auth.uid();
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'booster_profile.cpf_changed', 'booster_profile', auth.uid()::text,
          jsonb_build_object('changed', v_old is distinct from v_cpf));
  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.update_my_full_name(p_full_name text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_name text := nullif(btrim(p_full_name), '');
begin
  if not public.check_own_write_rate_limit('update_my_full_name', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if v_name is null or char_length(v_name) > 120 then
    return jsonb_build_object('success', false, 'error', 'full_name_required');
  end if;
  update public.booster_profiles set full_name = v_name, updated_at = now() where user_id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'booster_profile.full_name_changed', 'booster_profile', auth.uid()::text, '{}'::jsonb);
  return jsonb_build_object('success', true);
end;
$function$;

grant execute on function public.accept_legal(text), public.update_my_cpf(text), public.update_my_full_name(text),
  public.current_legal_version() to authenticated;
grant execute on function public.is_valid_cpf(text) to authenticated;

alter table public.booster_profiles add constraint booster_profiles_cpf_format check (cpf is null or cpf ~ '^[0-9]{11}$') not valid;

-- ===== M-06: comprovante tem que existir no bucket e pertencer ao pedido de saque =====
CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(p_request_id uuid, p_proof_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_proof_url is null or length(trim(p_proof_url)) = 0 then
    return jsonb_build_object('success', false, 'error', 'proof_required');
  end if;
  if p_proof_url not like p_request_id::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'payout-proofs' and o.name = p_proof_url) then
    return jsonb_build_object('success', false, 'error', 'invalid_proof');
  end if;

  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_req.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.payout_requests
    set status = 'paid', paid_at = now(), paid_by = auth.uid(), proof_url = p_proof_url, updated_at = now()
    where id = p_request_id;

  -- Lançamento informativo (valor 0): o débito real já ocorreu em
  -- 'payout_reservation' no momento da solicitação. Ver booster_payout_totals
  -- para a separação "reservado" vs. "pago" na exibição.
  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    v_req.booster_id, p_request_id, 'payout_paid', 0,
    'Solicitação de saque ' || p_request_id::text || ' paga', auth.uid(), 'admin'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin'::public.user_role, 'payout_request.paid', 'payout_request', p_request_id::text,
          jsonb_build_object('proof_url', p_proof_url));

  insert into public.notifications(user_id, type, title, body, data)
  values (v_req.booster_id, 'payout_request_paid', 'Saque pago',
          'Seu saque de R$ ' || v_req.amount::text || ' foi pago.',
          jsonb_build_object('payout_request_id', p_request_id));

  return jsonb_build_object('success', true);
end;
$function$;

-- ===== H-36 / M-10 / H-32 / H-40: rate limit nos RPCs de escrita do client =====
CREATE OR REPLACE FUNCTION public.booster_heartbeat()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if not public.check_own_write_rate_limit('booster_heartbeat', 30, 60) then
    return;
  end if;
  -- H-32: so grava se passou 30 s (cada UPDATE vira evento de Realtime).
  update public.booster_profiles
     set last_active_at = now()
   where user_id = auth.uid()
     and status = 'approved'
     and (last_active_at is null or last_active_at < now() - interval '30 seconds');
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_payout_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
begin
  if not public.check_own_write_rate_limit('cancel_payout_request', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null or v_req.booster_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_req.status not in ('requested', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.payout_requests
    set status = 'canceled', updated_at = now()
    where id = p_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    v_req.booster_id, p_request_id, 'payout_release', v_req.amount,
    'Solicitação de saque ' || p_request_id::text || ' cancelada pelo booster', auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.canceled', 'payout_request', p_request_id::text);

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_duo_own_riot_id(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
begin
  if not public.check_own_write_rate_limit('clear_duo_own_riot_id', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  update public.orders set duo_own_riot_id = null, updated_at = now() where id = p_order_id;
  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_order_completion(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
begin
  if not public.check_own_write_rate_limit('confirm_order_completion', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'awaiting_customer' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.orders set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_customer', 'completed', auth.uid(), 'Cliente confirmou a conclusão');

  if v_order.assigned_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (v_order.assigned_booster_id, 'order_completed', 'Cliente confirmou a conclusão!',
            'O cliente confirmou a entrega e seus ganhos foram liberados.',
            jsonb_build_object('order_id', p_order_id));
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_profile_exists(p_display_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_email      text;
  v_username   text;
  v_discord_id text;
begin
  if not public.check_own_write_rate_limit('ensure_profile_exists', 30, 60) then
    raise exception 'rate_limited';
  end if;
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select provider_id into v_discord_id
  from   auth.identities
  where  user_id = auth.uid() and provider = 'discord'
  limit  1;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    if v_discord_id is not null then
      update public.profiles
      set    discord_id = v_discord_id
      where  id = auth.uid() and discord_id is null;
    end if;
    return;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  v_email := coalesce(v_email, auth.uid()::text || '@oauth.local');

  v_username := coalesce(
    p_display_name,
    split_part(v_email, '@', 1),
    'user'
  );
  v_username := left(regexp_replace(v_username, '[^a-zA-Z0-9_]', '_', 'g'), 30);
  if v_username = '' then v_username := 'user'; end if;

  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 22) || '_' || left(auth.uid()::text, 7);
  end if;

  insert into public.profiles(id, email, role, username, discord_id)
  values (auth.uid(), v_email, 'customer'::public.user_role, v_username, v_discord_id)
  on conflict (id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_order_chat_read(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
begin
  if not public.check_own_write_rate_limit('mark_order_chat_read', 60, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  update public.order_messages
  set is_read = true
  where order_id = p_order_id
    and sender_id <> v_user_id
    and is_read = false;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.onboard_booster(p_display_name text, p_bio text, p_peak_rank jsonb, p_opgg_link text DEFAULT NULL::text, p_hours_per_day_min integer DEFAULT NULL::integer, p_hours_per_day_max integer DEFAULT NULL::integer, p_full_name text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text, p_available_days text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role;
  v_email     text;
  v_bio       text := nullif(btrim(p_bio), '');
  v_opgg      text := nullif(btrim(p_opgg_link), '');
  v_full_name text := nullif(btrim(p_full_name), '');
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_tier      text := p_peak_rank->>'tier';
  v_booster_id uuid;
  v_is_new_application boolean;
begin
  if not public.check_own_write_rate_limit('onboard_booster', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  v_is_new_application := not exists(select 1 from public.booster_profiles where user_id = auth.uid() and status <> 'rejected');

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  if nullif(btrim(p_display_name), '') is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if v_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;
  if v_full_name is null then
    return jsonb_build_object('success', false, 'error', 'full_name_required');
  end if;
  if not public.is_valid_cpf(v_cpf_digits) then
    return jsonb_build_object('success', false, 'error', 'invalid_cpf');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.booster_profiles(
    user_id, display_name, bio, status,
    peak_rank, opgg_link, hours_per_day_min, hours_per_day_max,
    full_name, email, cpf, available_days
  )
  values (
    auth.uid(), btrim(p_display_name), v_bio, 'pending',
    p_peak_rank, v_opgg, p_hours_per_day_min, p_hours_per_day_max,
    v_full_name, v_email, v_cpf_digits, p_available_days
  )
  on conflict (user_id) do update set
    display_name      = excluded.display_name,
    bio               = excluded.bio,
    peak_rank         = excluded.peak_rank,
    opgg_link         = excluded.opgg_link,
    hours_per_day_min = excluded.hours_per_day_min,
    hours_per_day_max = excluded.hours_per_day_max,
    full_name         = excluded.full_name,
    email             = excluded.email,
    cpf               = excluded.cpf,
    available_days    = excluded.available_days,
    status            = case when booster_profiles.status = 'rejected' then 'pending' else booster_profiles.status end,
    updated_at        = now()
  where booster_profiles.status in ('pending', 'rejected')
  returning id into v_booster_id;

  if v_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'application_not_editable');
  end if;

  if v_is_new_application then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'booster_pending_review', 'Novo booster pendente',
      btrim(p_display_name) || ' se candidatou como booster e está aguardando aprovação.',
      jsonb_build_object('booster_id', v_booster_id)
    from public.profiles where role = 'admin';

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-booster-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('booster_id', v_booster_id, 'display_name', btrim(p_display_name)),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_duo_account_reservation(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_account_id uuid;
begin
  if not public.check_own_write_rate_limit('release_duo_account_reservation', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id into v_order from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id into v_account_id from public.duo_accounts where reserved_order_id = p_order_id;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null,
      last_released_by = reserved_by, last_released_at = now()
  where reserved_order_id = p_order_id;

  if v_account_id is not null then
    update public.duo_account_reservations
    set released_at = now(), released_by = auth.uid()
    where account_id = v_account_id and released_at is null;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_payout(p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
  v_min_amount constant numeric := 50.00;
  v_withdrawal_day int;
begin
  if not public.check_own_write_rate_limit('request_payout', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if p_amount < v_min_amount then
    return jsonb_build_object('success', false, 'error', 'below_minimum_amount', 'minimum', v_min_amount);
  end if;

  v_withdrawal_day := extract(day from (now() at time zone 'America/Sao_Paulo'));
  if v_withdrawal_day not in (15, 30) then
    return jsonb_build_object('success', false, 'error', 'withdrawal_window_closed');
  end if;

  -- Serializa solicitações concorrentes do mesmo booster (evita duas
  -- requisições simultâneas passarem ambas no cheque de saldo antes de
  -- qualquer uma commitar).
  select * into v_booster from public.booster_profiles where user_id = auth.uid() for update;
  if v_booster is null or v_booster.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'booster_not_approved');
  end if;

  v_available := public.booster_available_balance(auth.uid());
  if p_amount > v_available then
    return jsonb_build_object('success', false, 'error', 'insufficient_balance', 'available', v_available);
  end if;

  insert into public.payout_requests(
    booster_id, amount, booster_cpf_snapshot, booster_legal_name_snapshot
  ) values (
    auth.uid(), p_amount, v_booster.cpf, v_booster.full_name
  )
  returning id into v_request_id;

  insert into public.booster_ledger_entries(
    booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
  ) values (
    auth.uid(), v_request_id, 'payout_reservation', -p_amount,
    'Reserva para solicitação de saque ' || v_request_id::text, auth.uid(), 'booster'::public.user_role
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'booster'::public.user_role, 'payout_request.created', 'payout_request', v_request_id::text,
          jsonb_build_object('amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'payout_request_created', 'Nova solicitação de saque',
         'Um booster solicitou saque de R$ ' || p_amount::text,
         jsonb_build_object('payout_request_id', v_request_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true, 'request_id', v_request_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_duo_account(p_order_id uuid, p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_previous_account_id uuid;
  v_reserved_id uuid;
begin
  if not public.check_own_write_rate_limit('reserve_duo_account', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, assigned_booster_id, boost_mode, status, wins_played, losses_played into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_order_status');
  end if;

  select id into v_previous_account_id
  from public.duo_accounts where reserved_order_id = p_order_id for update;

  if v_previous_account_id is not null and v_previous_account_id = p_account_id then
    return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', true);
  end if;

  if v_previous_account_id is not null and (coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0)) > 0 then
    return jsonb_build_object('success', false, 'error', 'cannot_switch_after_matches_played');
  end if;

  if v_previous_account_id is not null then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = auth.uid(), last_released_at = now()
    where id = v_previous_account_id;

    update public.duo_account_reservations
    set released_at = now(), released_by = auth.uid()
    where account_id = v_previous_account_id and released_at is null;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'booster'::public.user_role, 'duo_account.switched', 'order', p_order_id,
            jsonb_build_object('from_account_id', v_previous_account_id, 'to_account_id', p_account_id,
                                'order_status_at_switch', v_order.status));
  end if;

  update public.duo_accounts
  set reserved_by = auth.uid(), reserved_order_id = p_order_id, reserved_at = now()
  where id = p_account_id
    and reserved_by is null
    and is_active = true
    and public.duo_account_rank_is_valid(current_rank)
  returning id into v_reserved_id;

  if v_reserved_id is null then
    return jsonb_build_object('success', false, 'error', 'account_unavailable');
  end if;

  insert into public.duo_account_reservations(account_id, order_id, booster_id)
  values (p_account_id, p_order_id, auth.uid());

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'booster'::public.user_role, 'duo_account.reserved', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'account_id', p_account_id, 'already_reserved', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_duo_own_riot_id(p_order_id uuid, p_riot_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_trimmed text;
begin
  if not public.check_own_write_rate_limit('set_duo_own_riot_id', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if v_order.boost_mode is distinct from 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  v_trimmed := btrim(coalesce(p_riot_id, ''));
  -- Mesmo formato "Nome#TAG" validado no configurador do cliente
  -- (StepConfigure.tsx) -- precisa de conteúdo antes E depois do '#'.
  if length(v_trimmed) < 3 or length(v_trimmed) > 60
     or position('#' in v_trimmed) < 2
     or position('#' in v_trimmed) = length(v_trimmed) then
    return jsonb_build_object('success', false, 'error', 'invalid_riot_id');
  end if;

  update public.orders
    set duo_own_riot_id = v_trimmed, updated_at = now()
    where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_coaching_topic_done(p_order_id uuid, p_topic_id uuid, p_done boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
begin
  if not public.check_own_write_rate_limit('set_order_coaching_topic_done', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.service_type <> 'coaching' then
    return jsonb_build_object('success', false, 'code', 'not_coaching_order', 'message', 'Este pedido nao e de coaching.');
  end if;

  if v_order.assigned_booster_id is null or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'code', 'topics_unavailable', 'message', 'Os topicos ainda nao estao disponiveis para este pedido.');
  end if;

  update public.order_coaching_topics
  set is_done = p_done,
      completed_by = case when p_done then v_user_id else null end,
      completed_at = case when p_done then now() else null end
  where id = p_topic_id and order_id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'topic_not_found', 'message', 'Topico nao encontrado.');
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_booster_professional_profile(p_display_name text, p_bio text, p_peak_tier text, p_opgg_link text, p_opgg_link_visible boolean, p_available_days text[], p_hours_per_day_min integer, p_hours_per_day_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_bio          text := nullif(btrim(p_bio), '');
  v_opgg         text := nullif(btrim(p_opgg_link), '');
  v_current      record;
  v_days_remaining integer;
begin
  if not public.check_own_write_rate_limit('update_booster_professional_profile', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select display_name, display_name_changed_at into v_current
  from public.booster_profiles where user_id = auth.uid();

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;

  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;
  if v_bio is null then
    return jsonb_build_object('success', false, 'error', 'bio_required');
  end if;
  if p_peak_tier not in ('grandmaster', 'challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_peak_rank');
  end if;
  if v_opgg is null or v_opgg !~* '^https?://.+\..+' then
    return jsonb_build_object('success', false, 'error', 'invalid_opgg_link');
  end if;
  if p_available_days is null or array_length(p_available_days, 1) is null
     or not (p_available_days <@ array['mon','tue','wed','thu','fri','sat','sun']) then
    return jsonb_build_object('success', false, 'error', 'available_days_required');
  end if;
  if p_hours_per_day_min is null or p_hours_per_day_max is null
     or p_hours_per_day_min < 1 or p_hours_per_day_max > 24
     or p_hours_per_day_min > p_hours_per_day_max then
    return jsonb_build_object('success', false, 'error', 'invalid_hours');
  end if;

  if v_display_name is distinct from v_current.display_name then
    if exists (
      select 1 from public.booster_profiles
      where lower(display_name) = lower(v_display_name) and user_id <> auth.uid()
    ) then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;

    v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
    if v_days_remaining > 0 then
      return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
    end if;
  end if;

  update public.booster_profiles
  set display_name       = v_display_name,
      bio                = v_bio,
      peak_rank          = jsonb_build_object('tier', p_peak_tier, 'division', null),
      opgg_link          = v_opgg,
      opgg_link_visible  = coalesce(p_opgg_link_visible, true),
      available_days     = p_available_days,
      hours_per_day_min  = p_hours_per_day_min,
      hours_per_day_max  = p_hours_per_day_max,
      updated_at         = now()
  where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_duo_account_rank(p_account_id uuid, p_tier text, p_division text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account record;
begin
  if not public.check_own_write_rate_limit('update_duo_account_rank', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if not public.duo_account_rank_is_valid(jsonb_build_object('tier', p_tier, 'division', p_division)) then
    return jsonb_build_object('success', false, 'error', 'invalid_rank');
  end if;

  select id, reserved_by, last_released_by, last_released_at
  into v_account
  from public.duo_accounts
  where id = p_account_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  if not (
    public.is_admin()
    or v_account.reserved_by = auth.uid()
    or (
      v_account.reserved_by is null
      and v_account.last_released_by = auth.uid()
      and v_account.last_released_at > now() - interval '2 minutes'
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division),
      updated_at = now()
  where id = p_account_id;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_current_name text;
  v_days_remaining integer;
begin
  if not public.check_own_write_rate_limit('update_my_display_name', 5, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  select display_name into v_current_name from public.booster_profiles where user_id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;
  if v_display_name is null then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;

  if v_display_name is distinct from v_current_name then
    if exists (
      select 1 from public.booster_profiles
      where lower(display_name) = lower(v_display_name) and user_id <> auth.uid()
    ) then
      return jsonb_build_object('success', false, 'error', 'display_name_taken');
    end if;

    v_days_remaining := public.booster_display_name_cooldown_days_remaining(auth.uid());
    if v_days_remaining > 0 then
      return jsonb_build_object('success', false, 'error', 'display_name_cooldown', 'days_remaining', v_days_remaining);
    end if;
  end if;

  update public.booster_profiles set display_name = v_display_name where user_id = auth.uid();

  return jsonb_build_object('success', true);
end;
$function$;

-- ===== H-40: rejeitado pode reenviar a candidatura (volta para pending) =====
create or replace function public.prevent_non_admin_booster_status_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  if new.status is distinct from old.status and not public.is_admin()
     and not (old.status = 'rejected' and new.status = 'pending' and old.user_id = auth.uid()) then
    raise exception 'only admins can change booster application status';
  end if;
  return new;
end;
$function$;

-- ===== fecha o que sobrou de grants =====
revoke all on all sequences in schema public from anon, authenticated;
revoke maintain on all tables in schema public from anon, authenticated;
revoke all on public.available_boost_orders from anon;
-- anon so le catalogo publico (todo o resto ja era barrado so por RLS).
revoke select on all tables in schema public from anon;
grant select on public.games, public.services, public.service_extras, public.master_plus_pricing,
  public.win_price_cents_catalog, public.riot_league_cutoffs, public.booster_champion_stats,
  public.booster_performance_segments, public.booster_services, public.public_booster_profiles to anon;
grant select (id, booster_id, rating, content, created_at, is_public) on public.reviews to anon;
