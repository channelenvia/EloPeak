-- Baseline do schema public (dump de producao em 2026-10-08).
-- Zera as default privileges do Supabase local para que so valham os GRANTs
-- explicitos do dump (o dump so emite o que difere do padrao); as default
-- privileges reais de producao sao reaplicadas no fim deste arquivo.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";







SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."booster_status" AS ENUM (
    'pending',
    'under_review',
    'approved',
    'suspended',
    'rejected',
    'removed'
);


ALTER TYPE "public"."booster_status" OWNER TO "postgres";


CREATE TYPE "public"."clash_day" AS ENUM (
    'saturday',
    'sunday'
);


ALTER TYPE "public"."clash_day" OWNER TO "postgres";


CREATE TYPE "public"."clash_tier" AS ENUM (
    'tier_4',
    'tier_3',
    'tier_2',
    'tier_1'
);


ALTER TYPE "public"."clash_tier" OWNER TO "postgres";


CREATE TYPE "public"."drop_requester_role" AS ENUM (
    'booster',
    'admin',
    'customer'
);


ALTER TYPE "public"."drop_requester_role" OWNER TO "postgres";


CREATE TYPE "public"."ledger_entry_type" AS ENUM (
    'commission_credit',
    'commission_adjustment',
    'drop_penalty',
    'refund_debit',
    'manual_admin_adjustment',
    'payout_reservation',
    'payout_release',
    'payout_paid'
);


ALTER TYPE "public"."ledger_entry_type" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'draft',
    'awaiting_payment',
    'paid',
    'pending_review',
    'awaiting_assignment',
    'assigned',
    'in_progress',
    'paused',
    'drop_requested',
    'awaiting_customer',
    'completed',
    'disputed',
    'under_review',
    'refunded',
    'canceled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded',
    'partially_refunded',
    'disputed'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payout_request_status" AS ENUM (
    'requested',
    'under_review',
    'approved',
    'paid',
    'rejected',
    'canceled'
);


ALTER TYPE "public"."payout_request_status" OWNER TO "postgres";


CREATE TYPE "public"."payout_status" AS ENUM (
    'pending',
    'processing',
    'paid',
    'failed'
);


ALTER TYPE "public"."payout_status" OWNER TO "postgres";


CREATE TYPE "public"."queue_type" AS ENUM (
    'solo_duo',
    'flex'
);


ALTER TYPE "public"."queue_type" OWNER TO "postgres";


CREATE TYPE "public"."service_type" AS ENUM (
    'elo_boost',
    'win_boost',
    'coaching',
    'placement_matches',
    'md5',
    'clash'
);


ALTER TYPE "public"."service_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'customer',
    'booster',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_release_pending_review_order"("p_order_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order            record;
  v_exclusive_until  timestamptz;
  v_restored_status  public.order_status;
begin
  select id, status, customer_id, preferred_booster_id, service_type,
         assigned_booster_id, under_review_from_status, under_review_started_at
  into v_order
  from public.orders
  where id = p_order_id and status in ('pending_review', 'under_review')
  for update;

  if not found then
    return;
  end if;

  if v_order.assigned_booster_id is not null then
    v_restored_status := coalesce(v_order.under_review_from_status, 'assigned'::public.order_status);

    update public.orders
    set status                    = v_restored_status,
        match_sync_started_at     = case
          when match_sync_started_at is not null and v_order.under_review_started_at is not null
            then match_sync_started_at + (now() - v_order.under_review_started_at)
          else match_sync_started_at
        end,
        under_review_from_status  = null,
        under_review_started_at   = null,
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_restored_status, coalesce(p_actor_id, v_order.customer_id), p_reason);

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido liberado',
      'O pedido que estava em análise foi liberado -- você pode continuar de onde parou.',
      jsonb_build_object('order_id', p_order_id)
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido liberado',
        'A análise do seu pedido foi concluída -- ele voltou a andar normalmente.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    return;
  end if;

  v_exclusive_until := case
    when v_order.preferred_booster_id is not null and v_order.service_type <> 'coaching'
      then now() + interval '9 hours'
    else null
  end;

  update public.orders
  set status               = 'awaiting_assignment',
      exclusive_until      = v_exclusive_until,
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'awaiting_assignment', coalesce(p_actor_id, v_order.customer_id), p_reason);

  if v_order.preferred_booster_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.preferred_booster_id, 'exclusive_job', 'Pedido exclusivo para você!',
      'Um pedido foi reservado pra você. Você tem 9 horas para aceitar antes que ele volte para a fila geral.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."_release_pending_review_order"("p_order_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_boost_order"("p_order_id" "uuid", "p_booster_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_check jsonb;
  v_is_exclusive boolean;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('accept_boost_order', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booster_user_id::text, 0));

  select id, status, assigned_booster_id, boost_mode, preferred_booster_id, exclusive_until,
         service_type, credentials_set, reassigned_by_admin
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.status <> 'awaiting_assignment' or v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;
  if v_order.preferred_booster_id is distinct from p_booster_user_id and exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = p_order_id and dr.booster_id = p_booster_user_id and dr.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'previously_dropped_by_you');
  end if;
  if public.order_requires_access_token(v_order.service_type, v_order.boost_mode)
     and not v_order.credentials_set then
    return jsonb_build_object('success', false, 'error', 'missing_access_token');
  end if;
  if v_order.preferred_booster_id is not null
     and v_order.preferred_booster_id <> p_booster_user_id
     and (
       v_order.service_type = 'coaching'
       or (v_order.exclusive_until is not null and v_order.exclusive_until > now())
     ) then
    return jsonb_build_object('success', false, 'error', 'order_exclusive_to_another_booster');
  end if;

  if v_order.service_type = 'coaching' and v_order.preferred_booster_id = p_booster_user_id then
    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido de coaching reatribuído' else 'Booster aceitou o pedido de coaching' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', false, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_is_exclusive := v_order.preferred_booster_id is not null
    and v_order.preferred_booster_id = p_booster_user_id
    and v_order.exclusive_until is not null and v_order.exclusive_until > now();

  if v_is_exclusive then
    if not v_order.reassigned_by_admin and public.booster_has_active_exclusive_slot(p_booster_user_id) then
      return jsonb_build_object('success', false, 'error', 'exclusive_slot_already_used');
    end if;

    update public.orders
    set status = 'in_progress', assigned_booster_id = p_booster_user_id,
        used_exclusive_slot = not v_order.reassigned_by_admin,
        match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
    where id = p_order_id;

    insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, 'assigned', p_booster_user_id,
      case when v_order.reassigned_by_admin then 'Booster aceitou o pedido reatribuído' else 'Booster aceitou o pedido exclusivo' end
    );

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

    return jsonb_build_object(
      'success', true,
      'details', jsonb_build_object('used_exclusive_slot', not v_order.reassigned_by_admin, 'reassigned', v_order.reassigned_by_admin)
    );
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode, v_order.service_type::text);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set status = 'in_progress', assigned_booster_id = p_booster_user_id,
      match_sync_started_at = coalesce(match_sync_started_at, now()), updated_at = now()
  where id = p_order_id;

  insert into public.order_booster_assignments(order_id, booster_id) values (p_order_id, p_booster_user_id);

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'assigned', p_booster_user_id, 'Booster aceitou o pedido');

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'assigned', 'in_progress', p_booster_user_id, 'Início automático ao aceitar');

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;


ALTER FUNCTION "public"."accept_boost_order"("p_order_id" "uuid", "p_booster_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_order_coaching_topic"("p_order_id" "uuid", "p_content" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_topic_id uuid;
begin
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

  if char_length(v_content) < 1 or char_length(v_content) > 200 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'O topico deve ter entre 1 e 200 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('coaching_topic_' || replace(p_order_id::text, '-', ''), 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitos topicos em pouco tempo. Aguarde um minuto.');
  end if;

  insert into public.order_coaching_topics(order_id, content, created_by, created_by_role)
  values (p_order_id, v_content, v_user_id, v_role)
  returning id into v_topic_id;

  return jsonb_build_object('success', true, 'topic_id', v_topic_id);
end;
$$;


ALTER FUNCTION "public"."add_order_coaching_topic"("p_order_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_booster_balance"("p_booster_id" "uuid", "p_amount" numeric, "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  perform 1 from public.booster_profiles where user_id = p_booster_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  insert into public.booster_ledger_entries(booster_id, entry_type, amount, description, actor_id, actor_role)
  values (p_booster_id, 'manual_admin_adjustment', p_amount, v_reason, auth.uid(), 'admin'::public.user_role);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'booster.manual_balance_adjustment', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount));

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_booster_id, 'order_status_changed', 'Ajuste de saldo',
    (case when p_amount > 0 then 'R$ ' || p_amount::text || ' foi creditado ao seu saldo pela administração.'
          else 'R$ ' || abs(p_amount)::text || ' foi descontado do seu saldo pela administração.' end)
      || ' Motivo: ' || v_reason,
    jsonb_build_object('amount', p_amount)
  );

  return jsonb_build_object('success', true, 'new_balance', public.booster_available_balance(p_booster_id));
end;
$_$;


ALTER FUNCTION "public"."admin_adjust_booster_balance"("p_booster_id" "uuid", "p_amount" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_target record;
  v_reason text := coalesce(trim(p_reason), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, service_type, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;
  if v_order.assigned_booster_id is not null then
    return jsonb_build_object('success', false, 'error', 'order_has_active_booster');
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  update public.orders
  set status                = 'awaiting_assignment',
      preferred_booster_id  = p_target_booster_id,
      exclusive_until       = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      admin_review_locked   = false,
      review_release_at     = null,
      updated_at            = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (
    p_order_id, v_order.status, 'awaiting_assignment', auth.uid(),
    case when v_reason <> '' then 'Atribuído pelo admin: ' || v_reason else 'Atribuído pelo admin' end
  );

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'exclusive_job', 'Pedido reservado para você!',
    'Um administrador reservou este pedido pra você. Você tem 9 horas para aceitar antes que ele volte para a fila geral.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_assigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'target_booster_id', p_target_booster_id));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_manual_refund"("p_refund_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_refund public.refunds%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  perform 1 from public.orders where id = v_refund.order_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;

  update public.refunds set status = 'failed' where id = v_refund.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_canceled', 'order', v_refund.order_id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$$;


ALTER FUNCTION "public"."admin_cancel_manual_refund"("p_refund_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_pending_review_order"("p_order_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  update public.orders
  set status                    = 'canceled',
      assigned_booster_id       = null,
      preferred_booster_id      = case when v_order.assigned_booster_id is not null then null else preferred_booster_id end,
      exclusive_until           = case when v_order.assigned_booster_id is not null then null else exclusive_until end,
      used_exclusive_slot       = case when v_order.assigned_booster_id is not null then false else used_exclusive_slot end,
      under_review_from_status  = null,
      under_review_started_at   = null,
      admin_review_locked       = false,
      review_release_at         = null,
      updated_at                = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido cancelado',
      'Um pedido seu que estava em análise foi cancelado pela administração. Motivo: ' || v_reason,
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'canceled', auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.pending_review_canceled', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'had_assigned_booster', v_order.assigned_booster_id is not null));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido foi cancelado pela administração. Motivo: ' || v_reason
        || '. O reembolso será tratado manualmente pela nossa equipe.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_cancel_pending_review_order"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_confirm_manual_refund"("p_refund_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_refund public.refunds%rowtype;
  v_order  record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found or not v_refund.is_manual then
    return jsonb_build_object('success', false, 'error', 'refund_not_found');
  end if;

  -- Mesma ordem de lock do webhook e da criação: pedido primeiro, depois o reembolso.
  select id, status, customer_id into v_order from public.orders where id = v_refund.order_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'refund_not_pending');
  end if;

  update public.refunds set status = 'succeeded' where id = v_refund.id;

  update public.payments
  set refunded_amount = coalesce(refunded_amount, 0) + v_refund.amount, updated_at = now()
  where id = v_refund.payment_id;

  -- O webhook do Mercado Pago pode ter reembolsado o pedido no meio tempo.
  if v_order.status <> 'refunded' then
    update public.orders set status = 'refunded'::public.order_status, updated_at = now()
    where id = v_order.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_order.id, v_order.status, 'refunded'::public.order_status, auth.uid(),
            'Reembolso manual confirmado: ' || v_refund.reason);
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_confirmed', 'order', v_order.id::text,
          jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Reembolso processado',
      'R$ ' || v_refund.amount::text || ' foram reembolsados referentes ao seu pedido. Motivo: ' || v_refund.reason,
      jsonb_build_object('order_id', v_order.id, 'amount', v_refund.amount)
    );
  end if;

  return jsonb_build_object('success', true, 'refund_id', v_refund.id);
end;
$_$;


ALTER FUNCTION "public"."admin_confirm_manual_refund"("p_refund_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_manual_refund"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order            record;
  v_reason           text := trim(p_reason);
  v_total_paid       numeric;
  v_already_refunded numeric;
  v_remaining        numeric;
  v_payment_id       uuid;
  v_refund_id        uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  select id, total_price, customer_id, payment_status
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.payments where order_id = p_order_id and status not in ('pending', 'failed');

  -- Marcações desfeitas/falhas não seguram o valor do pedido.
  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds where order_id = p_order_id and status <> 'failed';

  v_remaining := v_total_paid - v_already_refunded;

  if v_remaining <= 0 then
    return jsonb_build_object('success', false, 'error', 'already_refunded');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('success', false, 'error', 'amount_exceeds_order_total');
  end if;

  select id into v_payment_id
  from public.payments where order_id = p_order_id order by created_at desc limit 1
  for update;

  if v_payment_id is null then
    return jsonb_build_object('success', false, 'error', 'payment_not_found');
  end if;

  insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status, is_manual)
  values (v_payment_id, p_order_id, 'manual-' || gen_random_uuid()::text, p_amount, v_reason, auth.uid(), 'pending', true)
  returning id into v_refund_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.manual_refund_marked', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'amount', p_amount, 'refund_id', v_refund_id));

  return jsonb_build_object('success', true, 'refund_id', v_refund_id, 'remaining', v_remaining - p_amount);
end;
$$;


ALTER FUNCTION "public"."admin_create_manual_refund"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_dashboard_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_total_revenue numeric;
  v_total_payouts numeric;
  v_active_orders integer;
  v_pending_boosters integer;
  v_recent_orders jsonb;
  v_daily_orders jsonb;
begin
  if not public.is_admin() then
    raise exception 'unauthorized';
  end if;

  select coalesce(sum(amount), 0) into v_total_revenue
  from public.payments where status = 'paid';

  select coalesce(sum(net_amount), 0) into v_total_payouts
  from public.payout_records;

  select count(*) into v_active_orders
  from public.orders where status in ('assigned', 'in_progress', 'paused');

  select count(*) into v_pending_boosters
  from public.booster_profiles where status in ('pending', 'under_review');

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_recent_orders from (
    select id, status, total_price, created_at
    from public.orders
    where status not in ('awaiting_payment', 'canceled')
    order by created_at desc
    limit 8
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_daily_orders from (
    select gs::date as day, count(o.id) as count
    from generate_series(current_date - interval '6 days', current_date, interval '1 day') gs
    left join public.orders o
      on o.created_at::date = gs::date
      and o.status not in ('awaiting_payment', 'canceled')
    group by gs
    order by gs
  ) t;

  return jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_payouts', v_total_payouts,
    'platform_profit', v_total_revenue - v_total_payouts,
    'active_orders_count', v_active_orders,
    'pending_boosters_count', v_pending_boosters,
    'recent_orders', v_recent_orders,
    'daily_orders', v_daily_orders
  );
end;
$$;


ALTER FUNCTION "public"."admin_dashboard_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_drop_order"("p_order_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_result jsonb;
  v_request_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, wins_played, losses_played
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_result := public.apply_order_drop(
    p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role,
    p_coaching_completion_pct
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_amount, status, admin_id, admin_note, resolved_at, requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(), 'admin'
  )
  returning id into v_request_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_dropped_by_admin', 'Você foi removido de um pedido',
    'Um administrador retirou você do pedido. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_drop_order"("p_order_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_flag_order_under_review"("p_order_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order       record;
  v_reason      text := trim(p_reason);
  v_from_status public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, customer_id, assigned_booster_id
  into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  v_from_status := v_order.status;

  if v_order.assigned_booster_id is not null then
    update public.orders
    set status                    = 'under_review',
        under_review_from_status  = v_from_status,
        under_review_started_at   = now(),
        admin_review_locked       = false,
        review_release_at         = null,
        updated_at                = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido entrou em análise manual da nossa equipe -- fica travado (sem novas partidas contabilizadas) até liberarmos de novo. Entraremos em contato pelo chat do pedido se precisarmos de mais informações.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido seu foi colocado em análise pela equipe -- sync de partidas e acesso à conta ficam pausados até liberarmos de novo. Você continua responsável por ele.',
      jsonb_build_object('order_id', p_order_id)
    );

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'from_status', v_from_status, 'booster_preserved', true));

    return jsonb_build_object('success', true);
  end if;

  update public.orders
  set status               = 'under_review',
      admin_review_locked  = false,
      review_release_at    = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, 'under_review', auth.uid(), v_reason);

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido em análise',
      'Seu pedido entrou em análise manual pela nossa equipe. Se precisarmos de mais informações, falaremos com você pelo chat do pedido.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.flagged_under_review', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'from_status', v_from_status));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_flag_order_under_review"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_boosters_with_slots"() RETURNS TABLE("id" "uuid", "user_id" "uuid", "display_name" "text", "status" "public"."booster_status", "is_top3" boolean, "solo_count" integer, "duo_count" integer, "total_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      bp.id,
      bp.user_id,
      bp.display_name,
      bp.status,
      bp.is_top3,
      coalesce(o.solo_count, 0)::integer,
      coalesce(o.duo_count, 0)::integer,
      coalesce(o.total_count, 0)::integer
    from public.booster_profiles bp
    left join lateral (
      select
        count(*) filter (where ord.boost_mode = 'solo') as solo_count,
        count(*) filter (where ord.boost_mode = 'duo')   as duo_count,
        count(*)                                          as total_count
      from public.orders ord
      where ord.assigned_booster_id = bp.user_id
        and ord.status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
    ) o on true
    order by bp.display_name asc;
end;
$$;


ALTER FUNCTION "public"."admin_list_boosters_with_slots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_pending_review_states"() RETURNS TABLE("order_id" "uuid", "admin_review_locked" boolean, "review_release_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  return query
  select o.id, o.admin_review_locked, o.review_release_at
  from public.orders o
  where o.status = 'pending_review';
end;
$$;


ALTER FUNCTION "public"."admin_list_pending_review_states"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_review_cases"() RETURNS TABLE("order_id" "uuid", "order_status" "public"."order_status", "total_price" numeric, "customer_id" "uuid", "last_assigned_booster_id" "uuid", "drop_count" integer, "refunded_amount" numeric, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    o.id, o.status, o.total_price, o.customer_id,
    (select oba.booster_id from public.order_booster_assignments oba
      where oba.order_id = o.id and oba.unassigned_at is not null
      order by oba.unassigned_at desc limit 1),
    o.drop_count,
    coalesce((select sum(r.amount) from public.refunds r where r.order_id = o.id), 0),
    o.updated_at
  from public.orders o
  where public.is_admin()
    and o.status = 'under_review'
  order by o.updated_at desc;
$$;


ALTER FUNCTION "public"."admin_list_review_cases"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_proof_url" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_req record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_proof_url is null or length(trim(p_proof_url)) = 0 then
    return jsonb_build_object('success', false, 'error', 'proof_required');
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
$_$;


ALTER FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_proof_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_override_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text" DEFAULT 'Admin override'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_actor record;
  v_reason text := trim(p_reason);
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  if p_new_status in ('awaiting_assignment', 'pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  if v_order.status::text = p_new_status then
    return jsonb_build_object('success', false, 'error', 'no_status_change');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.orders set status = p_new_status::public.order_status, updated_at = now()
  where  id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_new_status::public.order_status, auth.uid(), v_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
          jsonb_build_object('from', v_order.status, 'to', p_new_status));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_override_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reassign_booster"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order              record;
  v_reason             text := coalesce(trim(p_reason), '');
  v_target             record;
  v_result             jsonb;
  v_is_new_assignment  boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, assigned_booster_id, last_match_synced_at, customer_id, service_type
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  v_is_new_assignment := v_order.assigned_booster_id is null;

  if v_is_new_assignment then
    if v_order.status <> 'awaiting_assignment' then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
  else
    if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
      return jsonb_build_object('success', false, 'error', 'order_not_active');
    end if;
    if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
      return jsonb_build_object('success', false, 'error', 'sync_required_before_reassign');
    end if;
    if v_order.assigned_booster_id = p_target_booster_id then
      return jsonb_build_object('success', false, 'error', 'already_assigned_to_target');
    end if;
  end if;

  select user_id, status into v_target
  from public.booster_profiles where user_id = p_target_booster_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_found');
  end if;
  if v_target.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'target_booster_not_approved');
  end if;

  if not v_is_new_assignment then
    v_result := public.apply_order_drop(
      p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin'::public.drop_requester_role,
      p_coaching_completion_pct
    );

    if not (v_result->>'success')::boolean then
      return v_result;
    end if;

    if coalesce((v_result->>'under_review')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'drop_limit_reached', 'details', v_result);
    end if;
  end if;

  update public.orders
  set preferred_booster_id = p_target_booster_id,
      -- Coaching é reserva permanente do dono do pacote (mesmo critério de
      -- _release_pending_review_order) -- nunca expira, mesmo reatribuído.
      exclusive_until      = case when v_order.service_type = 'coaching' then null else now() + interval '9 hours' end,
      reassigned_by_admin  = true,
      duo_own_riot_id      = null,
      updated_at           = now()
  where id = p_order_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    p_target_booster_id, 'order_reassigned_by_admin',
    case when v_is_new_assignment then 'Um pedido foi reservado pra você' else 'Um pedido foi reatribuído a você' end,
    'Um administrador reservou este pedido pra você -- você tem 9 horas para aceitar na aba Jobs.'
      || case when v_reason <> '' then ' Motivo: ' || v_reason else '' end,
    jsonb_build_object('order_id', p_order_id)
  );

  if not v_is_new_assignment and v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Booster do seu pedido foi trocado',
      'Um administrador reatribuiu seu pedido para outro booster.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_reassigned', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'previous_booster_id', v_order.assigned_booster_id,
                              'new_booster_id', p_target_booster_id, 'new_assignment', v_is_new_assignment,
                              'drop_result', v_result));

  if v_is_new_assignment then
    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-order-channel',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object(
        'record', jsonb_build_object(
          'id', p_order_id, 'status', 'awaiting_assignment',
          'discord_voice_channel_id', null, 'discord_text_channel_id', null
        ),
        'old_record', jsonb_build_object('status', 'assigned')
      ),
      timeout_milliseconds := 10000
    );
  end if;

  return jsonb_build_object('success', true, 'drop_result', v_result);
end;
$$;


ALTER FUNCTION "public"."admin_reassign_booster"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_release_duo_account"("p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null,
      last_released_by = reserved_by, last_released_at = now()
  where id = p_account_id;

  if not found then return jsonb_build_object('success', false, 'error', 'account_not_found'); end if;

  update public.duo_account_reservations
  set released_at = now(), released_by = auth.uid()
  where account_id = p_account_id and released_at is null;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'admin'::public.user_role, 'duo_account.admin_released', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_release_duo_account"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_payout_request"("p_request_id" "uuid", "p_new_status" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_req record;
  v_new public.payout_request_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_new_status not in ('under_review', 'approved', 'rejected') then
    return jsonb_build_object('success', false, 'error', 'invalid_target_status');
  end if;
  v_new := p_new_status::public.payout_request_status;

  select * into v_req from public.payout_requests where id = p_request_id for update;
  if v_req is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_new = 'rejected' then
    if v_req.status not in ('requested', 'under_review', 'approved') then
      return jsonb_build_object('success', false, 'error', 'invalid_status');
    end if;
  else
    if v_req.status not in ('requested', 'under_review')
       or (v_new = 'under_review' and v_req.status <> 'requested')
    then
      return jsonb_build_object('success', false, 'error', 'invalid_status');
    end if;
  end if;

  update public.payout_requests
    set status = v_new,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        admin_note = coalesce(p_note, admin_note),
        rejection_reason = case when v_new = 'rejected' then p_note else rejection_reason end,
        updated_at = now()
    where id = p_request_id;

  if v_new = 'rejected' then
    insert into public.booster_ledger_entries(
      booster_id, payout_request_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_req.booster_id, p_request_id, 'payout_release', v_req.amount,
      'Solicitação de saque ' || p_request_id::text || ' rejeitada: ' || coalesce(p_note, 'sem motivo informado'),
      auth.uid(), 'admin'::public.user_role
    );
    insert into public.notifications(user_id, type, title, body, data)
    values (v_req.booster_id, 'payout_request_rejected', 'Solicitação de saque rejeitada',
            coalesce(p_note, 'Sua solicitação de saque foi rejeitada.'),
            jsonb_build_object('payout_request_id', p_request_id));
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin'::public.user_role, 'payout_request.' || p_new_status, 'payout_request', p_request_id::text,
          jsonb_build_object('note', p_note));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_review_payout_request"("p_request_id" "uuid", "p_new_status" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_order_chat_lock"("p_order_id" "uuid", "p_locked" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('success', false, 'code', 'forbidden', 'message', 'Apenas administradores podem controlar o chat.');
  end if;

  update public.orders
  set chat_locked = p_locked,
      chat_locked_by = case when p_locked then v_user_id else null end,
      chat_locked_at = case when p_locked then now() else null end,
      updated_at = now()
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (
    v_user_id,
    'admin'::public.user_role,
    case when p_locked then 'order_chat_locked' else 'order_chat_unlocked' end,
    'order',
    p_order_id,
    jsonb_build_object('chat_locked', p_locked)
  );

  return jsonb_build_object('success', true, 'chat_locked', p_locked);
end;
$$;


ALTER FUNCTION "public"."admin_set_order_chat_lock"("p_order_id" "uuid", "p_locked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('pending_review', 'under_review') then
    return jsonb_build_object('success', false, 'error', 'order_not_pending_review');
  end if;

  if p_locked then
    update public.orders set admin_review_locked = true, updated_at = now() where id = p_order_id;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_locked', 'order', p_order_id::text, '{}'::jsonb);
  else
    perform public._release_pending_review_order(p_order_id, auth.uid(), 'Liberado manualmente pelo admin');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.pending_review_unlocked', 'order', p_order_id::text, '{}'::jsonb);
  end if;

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_order_drop"("p_order_id" "uuid", "p_from_status" "text", "p_actor_id" "uuid", "p_reason" "text", "p_requester_role" "public"."drop_requester_role", "p_coaching_completion_pct" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_order                 record;
  v_is_top3                boolean;
  v_share_pct              numeric;
  v_is_positive            boolean;
  v_over_limit             boolean;
  v_payout                 numeric := 0;
  v_penalty                numeric := 0;
  v_new_total_price        numeric;
  v_new_wins_purchased     integer;
  v_new_estimated_hours    numeric;
  v_new_current_rank       jsonb;
  v_latest_rank            record;
  v_win_value_unit         numeric;
  v_divisions_remaining    numeric;
  v_division_value_full    numeric;
  v_division_value_share   numeric;
  v_steps_crossed          integer;
  v_win_value_master_cents integer;
  v_win_value_master_full  numeric;
  v_win_value_master_share numeric;
  v_cutoff_pdl             integer;
  v_original_pdl           integer;
  v_latest_pdl             integer;
  v_new_current_pdl        integer;
  v_pdl_remaining          numeric;
  v_quarter_pdl            numeric;
  v_booster_share          numeric;
  v_quarter_value          numeric;
  v_quarters_completed     integer;
  v_completion_pct         numeric;
  v_completion_frac        numeric;
begin
  select id, service_type, boost_mode, queue_type, total_price, current_rank, target_rank,
         current_pdl, customer_id, assigned_booster_id, estimated_hours, wins_played,
         losses_played, wins_purchased, drop_count, status
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned');
  end if;

  if v_order.status::text <> p_from_status then
    return jsonb_build_object('success', false, 'error', 'order_status_mismatch');
  end if;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id for update;
  -- Coaching tem taxa própria e fixa (70%, ver trg_fn_order_completed_booster_stats
  -- e boosterEarningsShare em src/lib/utils.ts) -- não varia com is_top3.
  v_share_pct := case
    when v_order.service_type = 'coaching' then 0.70
    when v_is_top3 then 0.60
    else 0.55
  end;

  v_is_positive := coalesce(v_order.wins_played, 0) >= coalesce(v_order.losses_played, 0);
  v_over_limit  := v_order.drop_count >= 2;
  v_new_current_pdl := v_order.current_pdl;

  -- ── Limite de 2 drops: cancela em vez de reabrir, tudo manual daqui ────
  if v_over_limit then
    update public.orders set
      status                = 'under_review',
      assigned_booster_id   = null,
      preferred_booster_id  = null,
      exclusive_until       = null,
      used_exclusive_slot   = false,
      duo_own_riot_id       = null,
      drop_count            = drop_count + 1,
      last_dropped_at       = now(),
      updated_at            = now()
    where id = p_order_id;

    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null
    where reserved_order_id = p_order_id;

    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, p_from_status::public.order_status, 'under_review', p_actor_id,
      'Limite de 2 drops atingido -- pedido cancelado; reembolso do cliente e saldo do booster pendentes de resolução manual. ' || p_reason
    );

    if v_order.customer_id is not null then
      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.customer_id, 'order_status_changed', 'Pedido em análise',
        'Seu pedido atingiu o limite de drops e está sendo analisado manualmente pela nossa equipe. Entraremos em contato pelo chat do pedido.',
        jsonb_build_object('order_id', p_order_id)
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_status_changed', 'Pedido em análise',
      'Um pedido que você tinha foi cancelado após atingir o limite de drops e está em análise manual da equipe.',
      jsonb_build_object('order_id', p_order_id)
    );

    return jsonb_build_object('success', true, 'under_review', true, 'drop_count', v_order.drop_count + 1);
  end if;

  -- ── Win Boost / MD5 ──────────────────────────────────────────────────
  if v_order.service_type in ('win_boost', 'md5') then
    v_win_value_unit := case
      when coalesce(v_order.wins_purchased, 0) > 0 then v_order.total_price / v_order.wins_purchased
      else 0
    end;

    v_new_wins_purchased := greatest(0,
      coalesce(v_order.wins_purchased, 0) - coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0));

    v_new_total_price := round(v_win_value_unit * v_new_wins_purchased, 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null and coalesce(v_order.wins_purchased, 0) > 0
        then round(v_order.estimated_hours / v_order.wins_purchased * v_new_wins_purchased, 2)
      else v_order.estimated_hours
    end;
    v_new_current_rank := v_order.current_rank;

    if v_is_positive then
      -- least() trava o payout no que foi contratado -- sem isso, partidas
      -- sincronizadas depois do drop_requested (cron continua rodando nesse
      -- status) pagavam por vitórias além de wins_purchased.
      v_payout := round(v_win_value_unit * v_share_pct * least(coalesce(v_order.wins_played, 0), coalesce(v_order.wins_purchased, 0)), 2);
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_unit, round(v_win_value_unit * v_share_pct, 2), v_order.losses_played);
    end if;

  -- ── Elo/Duo Boost: current_rank/target_rank nulos são um estado de dados
  -- inválido pra esse service_type (nunca deveriam estar assim num pedido
  -- ativo) -- sem essa guarda, rank_step(null, ...) propaga NULL até
  -- total_price silenciosamente. Falha alto e claro em vez disso.
  elsif v_order.service_type = 'elo_boost' and (v_order.current_rank is null or v_order.target_rank is null) then
    return jsonb_build_object('success', false, 'error', 'missing_rank_data');

  -- ── Elo/Duo Boost -- Mestre+ (current tier já em master/gm/challenger) ─
  elsif v_order.service_type = 'elo_boost'
    and (v_order.current_rank->>'tier') in ('master', 'grandmaster', 'challenger') then

    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    select fetched_tier, fetched_division, fetched_lp
    into v_latest_rank
    from public.order_rank_verifications
    where order_id = p_order_id order by created_at desc limit 1;

    v_latest_pdl := coalesce(v_latest_rank.fetched_lp, v_order.current_pdl, 0);
    v_new_current_pdl := v_latest_pdl;
    v_new_current_rank := case
      when v_latest_rank.fetched_tier is not null
        then jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division)
      else v_order.current_rank
    end;

    v_win_value_master_cents := public.win_price_cents(
      v_order.queue_type,
      v_order.boost_mode,
      coalesce(v_latest_rank.fetched_tier, v_order.current_rank->>'tier')
    );
    v_win_value_master_full  := v_win_value_master_cents / 100.0;
    -- Comissão fixa de 45% só neste ramo (negativo, quando o cliente pede) --
    -- diferente do share_pct dinâmico (55/60 top3) usado em todo o resto.
    v_win_value_master_share := round(v_win_value_master_full * 0.55, 2);

    if v_is_positive then
      v_cutoff_pdl := coalesce(
        (select cutoff_lp from public.riot_league_cutoffs
          where queue = v_order.queue_type and tier = v_order.target_rank->>'tier'),
        case v_order.target_rank->>'tier'
          when 'grandmaster' then 1200
          when 'challenger' then 2200
          else 0
        end
      );
      v_original_pdl := coalesce(v_order.current_pdl, 0);

      v_pdl_remaining := greatest(0, v_cutoff_pdl - v_original_pdl);
      v_quarter_pdl    := v_pdl_remaining / 4.0;
      v_booster_share  := round(v_order.total_price * v_share_pct, 2);
      v_quarter_value  := round(v_booster_share / 4.0, 2);

      v_quarters_completed := case
        when v_quarter_pdl <= 0 then 4
        else least(4, floor(greatest(0, v_latest_pdl - v_original_pdl) / v_quarter_pdl)::integer)
      end;

      v_payout := v_quarter_value * v_quarters_completed;
      -- total_price é o bruto pago pelo cliente. Remove a fração bruta
      -- concluída; subtrair v_payout aplicava a comissão uma segunda vez ao
      -- próximo booster.
      v_new_total_price := greatest(0, round(
        v_order.total_price * (1 - v_quarters_completed / 4.0), 2
      ));
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role, v_win_value_master_full, v_win_value_master_share, v_order.losses_played);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Elo/Duo Boost -- padrão (abaixo de Mestre) ──────────────────────────
  elsif v_order.service_type = 'elo_boost' then
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_estimated_hours := v_order.estimated_hours;

    v_divisions_remaining := greatest(0,
      public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division')
      - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division'));

    v_division_value_full  := case when v_divisions_remaining > 0 then v_order.total_price / v_divisions_remaining else 0 end;
    v_division_value_share := round(v_division_value_full * v_share_pct, 2);

    select fetched_tier, fetched_division into v_latest_rank
      from public.order_rank_verifications
      where order_id = p_order_id order by created_at desc limit 1;

    if v_latest_rank.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest_rank.fetched_tier, 'division', v_latest_rank.fetched_division);
      -- least() trava em v_divisions_remaining -- sem isso, uma conta que
      -- sobe além do rank alvo contratado (partidas sincronizadas depois do
      -- drop_requested) pagava por divisões nunca vendidas neste pedido.
      v_steps_crossed := least(v_divisions_remaining::integer, greatest(0,
        public.rank_step(v_latest_rank.fetched_tier, v_latest_rank.fetched_division)
        - public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division')));
    else
      v_new_current_rank := v_order.current_rank;
      v_steps_crossed := 0;
    end if;

    if v_is_positive then
      v_payout := round(v_division_value_share * v_steps_crossed, 2);
      -- O preço do pedido é bruto, portanto também precisa ser reduzido
      -- pelo valor bruto das divisões concluídas.
      v_new_total_price := greatest(0, round(
        v_order.total_price - (v_division_value_full * v_steps_crossed), 2
      ));
    else
      v_penalty := public.compute_drop_penalty(
        p_requester_role,
        round(v_division_value_full / 4.0, 2),
        round(v_division_value_share / 4.0, 2),
        v_order.losses_played);
      v_new_total_price := round(v_order.total_price + v_penalty, 2);
    end if;

  -- ── Demais tipos (coaching, placement_matches, clash): sem fórmula
  -- específica no plano -- mantém o cálculo proporcional genérico de
  -- antes (completion_pct * share_pct), sem penalidade negativa. Coaching
  -- usa v_share_pct = 0.70 (fixo, ver acima); placement_matches/clash
  -- continuam em 0.55/0.60 por is_top3, sem taxa própria definida.
  --
  -- Coaching aceita um % de conclusão informado manualmente pelo admin
  -- (p_coaching_completion_pct) em vez do automático (sempre 0, sem métrica
  -- de sessões entregues) -- clash/placement_matches continuam 100%
  -- automáticos (ignoram o parâmetro, mesmo que informado por engano).
  else
    if v_order.service_type = 'coaching' and p_coaching_completion_pct is not null then
      v_completion_pct := greatest(0, least(100, p_coaching_completion_pct));
    else
      v_completion_pct := public.order_drop_completion_pct(p_order_id);
    end if;
    v_completion_frac := v_completion_pct / 100.0;
    v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
      else null
    end;
    v_new_wins_purchased := v_order.wins_purchased;
    v_new_current_rank := v_order.current_rank;
    v_payout := round(v_order.total_price * v_share_pct * v_completion_frac, 2);
  end if;

  -- ── Aplica o resultado ao pedido ────────────────────────────────────
  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    duo_own_riot_id        = null,
    total_price            = v_new_total_price,
    base_price             = v_new_total_price,
    extras_price           = 0,
    discount_price         = 0,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    current_pdl            = v_new_current_pdl,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id
    and booster_id = v_order.assigned_booster_id
    and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial pelo progresso entregue no pedido ' || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'R$ ' || v_payout::text || ' foi creditado ao seu saldo pelo progresso entregue antes do drop.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout)
    );
  end if;

  if v_penalty > 0 then
    -- Espelha o crédito de payout logo acima -- sem isso, total_earnings
    -- (exibido ao admin em BoosterDetail.tsx) ficava inflado depois de
    -- qualquer drop com penalidade (o saldo sacável real já vinha certo,
    -- por ser derivado do ledger via booster_available_balance).
    update public.booster_profiles set total_earnings = total_earnings - v_penalty
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(booster_id, order_id, entry_type, amount, description, actor_id, actor_role)
    values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_penalty,
      'Penalidade por drop em desvantagem no pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Penalidade de drop aplicada',
      'R$ ' || v_penalty::text || ' foi descontado do seu saldo por dropar o pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_penalty)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payout_amount', v_payout,
    'penalty_amount', v_penalty,
    'new_total_price', v_new_total_price,
    'is_positive', v_is_positive
  );
end;
$_$;


ALTER FUNCTION "public"."apply_order_drop"("p_order_id" "uuid", "p_from_status" "text", "p_actor_id" "uuid", "p_reason" "text", "p_requester_role" "public"."drop_requester_role", "p_coaching_completion_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_booster"("p_booster_id" "uuid", "p_new_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor record;
  v_booster_user_id uuid;
  v_status public.booster_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_new_status not in ('pending', 'under_review', 'approved', 'rejected', 'suspended') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  v_status := p_new_status::public.booster_status;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set    status          = v_status,
         verified_at     = case when v_status = 'approved' then now() else null end,
         suspended_until = case when v_status = 'suspended' then now() + interval '24 hours' else null end,
         updated_at      = now()
  where  id = p_booster_id
  returning user_id into v_booster_user_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  update public.profiles
  set role = case when v_status = 'approved' then 'booster'::public.user_role else 'customer'::public.user_role end,
      updated_at = now()
  where id = v_booster_user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role, 'booster.' || v_status::text, 'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."approve_booster"("p_booster_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_active_slot_counts"("p_booster_user_id" "uuid") RETURNS TABLE("solo_count" integer, "duo_count" integer, "total_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      count(*) filter (where boost_mode = 'solo')::integer,
      count(*) filter (where boost_mode = 'duo')::integer,
      count(*)::integer
    from public.orders
    where assigned_booster_id = p_booster_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
      and not used_exclusive_slot
      and service_type <> 'coaching'
      and not reassigned_by_admin;
end;
$$;


ALTER FUNCTION "public"."booster_active_slot_counts"("p_booster_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_assigned_at"("p_order_id" "uuid", "p_played_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select booster_id
  from public.order_booster_assignments
  where order_id = p_order_id
    and assigned_at <= p_played_at
    and (unassigned_at is null or unassigned_at > p_played_at)
  order by assigned_at desc
  limit 1
$$;


ALTER FUNCTION "public"."booster_assigned_at"("p_order_id" "uuid", "p_played_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_available_balance"("p_booster_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() = p_booster_id or public.is_admin()
      then coalesce((select sum(amount) from public.booster_ledger_entries where booster_id = p_booster_id), 0)
    else null
  end;
$$;


ALTER FUNCTION "public"."booster_available_balance"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_display_name_cooldown_days_remaining"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select case
       when p.display_name_changed_at is null or p.display_name_changed_at <= now() - interval '30 days' then 0
       else ceil(extract(epoch from ((p.display_name_changed_at + interval '30 days') - now())) / 86400)::integer
     end
     from public.booster_profiles p
     where p.user_id = p_user_id
       and (auth.uid() = p_user_id or public.is_admin())),
    0
  );
$$;


ALTER FUNCTION "public"."booster_display_name_cooldown_days_remaining"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_has_active_exclusive_slot"("p_booster_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return exists (
    select 1 from public.orders
    where assigned_booster_id = p_booster_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
      and used_exclusive_slot
  );
end;
$$;


ALTER FUNCTION "public"."booster_has_active_exclusive_slot"("p_booster_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_heartbeat"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  update public.booster_profiles
     set last_active_at = now()
   where user_id = auth.uid()
     and status = 'approved';
$$;


ALTER FUNCTION "public"."booster_heartbeat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booster_payout_totals"("p_booster_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not (auth.uid() = p_booster_id or public.is_admin()) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'success', true,
    'available_balance', public.booster_available_balance(p_booster_id),
    'total_earned', coalesce((
      select sum(amount) from public.booster_ledger_entries
      where booster_id = p_booster_id and entry_type = 'commission_credit'
    ), 0),
    'reserved', coalesce((
      select sum(le.amount) * -1 from public.booster_ledger_entries le
      join public.payout_requests pr on pr.id = le.payout_request_id
      where le.booster_id = p_booster_id and le.entry_type = 'payout_reservation'
        and pr.status in ('requested', 'under_review', 'approved')
    ), 0),
    'total_paid', coalesce((
      select sum(le.amount) * -1 from public.booster_ledger_entries le
      join public.payout_requests pr on pr.id = le.payout_request_id
      where le.booster_id = p_booster_id and le.entry_type = 'payout_reservation'
        and pr.status = 'paid'
    ), 0)
  );
end;
$$;


ALTER FUNCTION "public"."booster_payout_totals"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_booster_accept_order"("p_booster_user_id" "uuid", "p_boost_mode" "text", "p_service_type" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_top3         boolean;
  v_max_total       integer;
  v_solo_count      integer;
  v_duo_count       integer;
  v_total_count     integer;
  v_exclusive_used  boolean;
begin
  select is_top3 into v_is_top3
  from public.booster_profiles
  where user_id = p_booster_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'booster_not_approved');
  end if;

  v_max_total := case when v_is_top3 then 4 else 3 end;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  v_exclusive_used := public.booster_has_active_exclusive_slot(p_booster_user_id);

  if p_service_type = 'coaching' then
    return jsonb_build_object(
      'allowed', true,
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'is_top3', v_is_top3,
    'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
  );
end;
$$;


ALTER FUNCTION "public"."can_booster_accept_order"("p_booster_user_id" "uuid", "p_boost_mode" "text", "p_service_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_payout_request"("p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_req record;
begin
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
$$;


ALTER FUNCTION "public"."cancel_payout_request"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_pending_order_payment"("p_order_id" "uuid", "p_customer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders
  where id = p_order_id and customer_id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status <> 'awaiting_payment' then
    return jsonb_build_object('success', false, 'error', 'order_not_awaiting_payment');
  end if;

  -- Lock the payment row too so a concurrent webhook can't flip it under us
  -- between this check and the updates below.
  perform 1 from public.payments where order_id = p_order_id for update;

  update public.payments
  set status = 'failed', updated_at = now()
  where order_id = p_order_id and customer_id = p_customer_id and status = 'pending';

  update public.orders
  set status = 'canceled', updated_at = now()
  where id = p_order_id and customer_id = p_customer_id and status = 'awaiting_payment';

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'awaiting_payment', 'canceled', p_customer_id,
          'Cancelado pelo cliente antes da confirmação do pagamento');

  return jsonb_build_object('success', true, 'order_id', p_order_id, 'canceled', true);
end;
$$;


ALTER FUNCTION "public"."cancel_pending_order_payment"("p_order_id" "uuid", "p_customer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_own_write_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    return false;
  end if;
  v_result := public.consume_edge_rate_limit(p_scope, v_uid::text, p_limit, p_window_seconds);
  return coalesce((v_result->>'allowed')::boolean, false);
end;
$$;


ALTER FUNCTION "public"."check_own_write_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_duo_own_riot_id"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
begin
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
$$;


ALTER FUNCTION "public"."clear_duo_own_riot_id"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_terminal_order_credentials"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if new.status in ('completed', 'canceled', 'refunded', 'disputed')
     or new.payment_status is distinct from 'paid'::public.payment_status then
    new.game_credentials := null;
    new.credentials_set := false;
    new.credential_expires_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."clear_terminal_order_credentials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_verified_order"("p_order_id" "uuid", "p_fetched_tier" "text", "p_fetched_division" "text", "p_requested_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_order record;
  v_target_tier text;
  v_target_division text;
begin
  select id, status, customer_id, assigned_booster_id, target_rank into v_order
  from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if v_order.assigned_booster_id is distinct from p_requested_by then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_order.target_rank is null then
    return jsonb_build_object('success', false, 'error', 'no_target_rank');
  end if;

  v_target_tier := v_order.target_rank->>'tier';
  v_target_division := v_order.target_rank->>'division';

  if public.rank_step(p_fetched_tier, p_fetched_division) is null
     or public.rank_step(v_target_tier, v_target_division) is null then
    return jsonb_build_object('success', false, 'error', 'invalid_rank_data');
  end if;

  if public.rank_step(p_fetched_tier, p_fetched_division) < public.rank_step(v_target_tier, v_target_division) then
    return jsonb_build_object('success', false, 'error', 'target_not_reached');
  end if;

  -- Rank alvo confirmado via Riot API -- mesmo assim vai pra
  -- 'awaiting_customer', não direto pra 'completed'. O cliente ainda
  -- precisa confirmar a entrega, igual a todo outro tipo de serviço; sem
  -- isso, elo_boost era o único fluxo que nunca passava pela confirmação
  -- (e nunca dava chance de abrir disputa) antes de liberar o pagamento.
  if v_order.status <> 'awaiting_customer' then
    update public.orders set status = 'awaiting_customer', updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, 'awaiting_customer', p_requested_by, 'Rank alvo verificado via Riot API');
  end if;

  insert into public.notifications(user_id, type, title, body, data)
  values (v_order.customer_id, 'order_status_changed', 'Objetivo alcançado!',
          'Verificamos que sua conta atingiu o rank alvo. Confirme a conclusão do pedido.',
          jsonb_build_object('order_id', p_order_id));

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."complete_verified_order"("p_order_id" "uuid", "p_fetched_tier" "text", "p_fetched_division" "text", "p_requested_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_drop_penalty"("p_requester_role" "public"."drop_requester_role", "p_full_value" numeric, "p_share_value" numeric, "p_losses_played" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select round(
    (case when p_requester_role = 'booster' then p_full_value else p_share_value end)
    * coalesce(p_losses_played, 0), 2);
$$;


ALTER FUNCTION "public"."compute_drop_penalty"("p_requester_role" "public"."drop_requester_role", "p_full_value" numeric, "p_share_value" numeric, "p_losses_played" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_order_completion"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
begin
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
$$;


ALTER FUNCTION "public"."confirm_order_completion"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
declare
  v_row public.edge_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_scope !~ '^[a-z0-9_-]{1,64}$' or char_length(p_subject) > 128
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit configuration';
  end if;

  insert into public.edge_rate_limits(scope, subject, window_started_at, request_count)
  values (p_scope, p_subject, v_now, 1)
  on conflict (scope, subject) do update set
    window_started_at = case
      when edge_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else edge_rate_limits.window_started_at
    end,
    request_count = case
      when edge_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else edge_rate_limits.request_count + 1
    end
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.request_count <= p_limit,
    'retry_after', greatest(1, ceil(extract(epoch from (
      v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now
    )))::integer)
  );
end;
$_$;


ALTER FUNCTION "public"."consume_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select role from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dedupe_provider_refund_after_manual"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_manual numeric;
begin
  if coalesce(new.is_manual, false) then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_manual
  from public.refunds
  where order_id = new.order_id and is_manual and status <> 'failed';

  if v_manual <= 0 then
    return new;
  end if;

  update public.refunds set status = 'succeeded'
  where order_id = new.order_id and is_manual and status = 'pending';

  if v_manual >= new.amount then
    return null;
  end if;

  new.amount := new.amount - v_manual;
  return new;
end;
$$;


ALTER FUNCTION "public"."dedupe_provider_refund_after_manual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_duo_account"("p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_reserved_by uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select reserved_by into v_reserved_by from public.duo_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_reserved_by is not null then
    return jsonb_build_object('success', false, 'error', 'account_reserved');
  end if;

  delete from public.duo_accounts where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.deleted', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."delete_duo_account"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."duo_account_rank_is_valid"("p_rank" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select p_rank is not null
    and p_rank->>'tier' in ('iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond')
    and p_rank->>'division' in ('IV', 'III', 'II', 'I')
$$;


ALTER FUNCTION "public"."duo_account_rank_is_valid"("p_rank" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_profile_exists"("p_display_name" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_email      text;
  v_username   text;
  v_discord_id text;
begin
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
$$;


ALTER FUNCTION "public"."ensure_profile_exists"("p_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expel_booster"("p_booster_id" "uuid", "p_reason" "text", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor         record;
  v_booster       record;
  v_active_orders integer;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, user_id, status into v_booster
  from public.booster_profiles where id = p_booster_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'booster_not_found');
  end if;

  if v_booster.status <> 'removed' then
    select count(*) into v_active_orders
    from public.orders
    where assigned_booster_id = v_booster.user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested');

    if v_active_orders > 0 then
      return jsonb_build_object('success', false, 'error', 'active_orders_exist');
    end if;
  end if;

  select id, role into v_actor from public.profiles where id = p_actor_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'actor_not_found');
  end if;

  update public.booster_profiles
  set status = 'removed', suspended_until = null, updated_at = now()
  where id = p_booster_id;

  update public.profiles
  set role = 'customer'::public.user_role, updated_at = now()
  where id = v_booster.user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'booster.removed', 'booster_profile', p_booster_id::text,
          jsonb_build_object('reason', trim(p_reason)));

  return jsonb_build_object('success', true, 'user_id', v_booster.user_id);
end;
$$;


ALTER FUNCTION "public"."expel_booster"("p_booster_id" "uuid", "p_reason" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_booster_suspensions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_booster record;
begin
  for v_booster in
    select id, user_id
    from public.booster_profiles
    where status = 'suspended'
      and suspended_until is not null
      and suspended_until <= now()
    for update
  loop
    update public.booster_profiles
    set status = 'approved', suspended_until = null, verified_at = now(), updated_at = now()
    where id = v_booster.id;

    update public.profiles
    set role = 'booster'::public.user_role, updated_at = now()
    where id = v_booster.user_id
      and role <> 'admin';

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
    values (v_booster.user_id, 'booster', 'booster.auto_reactivated', 'booster_profile', v_booster.id::text);
  end loop;
end;
$$;


ALTER FUNCTION "public"."expire_stale_booster_suspensions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_pix_orders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  with expired as (
    update public.orders o
    set status = 'canceled', updated_at = now()
    where o.status = 'awaiting_payment'
      and o.mp_payment_id is not null
      and exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and p.mp_payment_id = o.mp_payment_id
          and p.status = 'pending'
          and coalesce(p.metadata->>'method', 'pix') = 'pix'
          and p.created_at < now() - interval '35 minutes'
      )
    returning o.id, o.customer_id
  )
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  select
    id, 'awaiting_payment', 'canceled', customer_id,
    'PIX expirado sem confirmação de pagamento'
  from expired;
end;
$$;


ALTER FUNCTION "public"."expire_stale_pix_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_order_state"("p_order_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_customer_id uuid := auth.uid();
  v_order record;
  v_requires_credentials boolean;
  v_is_active_paid boolean;
begin
  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_order_id is null then
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where customer_id = v_customer_id
      and status = 'awaiting_payment'
    order by created_at desc
    limit 1;

    if not found then
      return jsonb_build_object('success', true, 'order_id', null);
    end if;
  else
    select id, status, payment_status, service_type, boost_mode, credentials_set
    into v_order
    from public.orders
    where id = p_order_id
      and customer_id = v_customer_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'order_not_found');
    end if;
  end if;

  v_requires_credentials := public.order_requires_access_token(
    v_order.service_type,
    v_order.boost_mode
  );
  v_is_active_paid := v_order.payment_status = 'paid'::public.payment_status
    and v_order.status in (
      'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer'
    );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'can_pay', v_order.status = 'awaiting_payment'
      and coalesce(v_order.payment_status, 'pending'::public.payment_status) = 'pending'::public.payment_status,
    'payment_confirmed', v_is_active_paid,
    'requires_credentials', v_requires_credentials,
    'credentials_set', v_order.credentials_set,
    'can_submit_credentials', v_is_active_paid and v_requires_credentials,
    'can_confirm_completion', v_order.status = 'awaiting_customer'
  );
end;
$$;


ALTER FUNCTION "public"."get_customer_order_state"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_duo_account_access_token"("p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_cipher bytea;
  v_token_id uuid;
  v_expires_at timestamptz := now() + interval '5 minutes';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('get_duo_account_access_token', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, encrypted_credentials, reserved_by, reserved_order_id
  into v_account
  from public.duo_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_account.reserved_by is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_reserved_by_you');
  end if;
  if v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(decode(v_account.encrypted_credentials, 'base64'), v_key);
  exception when others then
    begin
      v_decrypted := pgp_sym_decrypt(v_account.encrypted_credentials::bytea, v_key);
    exception when others then
      return jsonb_build_object('success', false, 'error', 'decrypt_failed');
    end;
  end;

  begin
    v_payload := v_decrypted::jsonb;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
  end;
  if nullif(v_payload->>'login', '') is null or nullif(v_payload->>'password', '') is null then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
  end if;

  v_token_id := gen_random_uuid();

  v_cipher := pgp_sym_encrypt(jsonb_build_object(
    'v', 2,
    'kind', 'duo_account_access',
    'token_id', v_token_id,
    'account_id', p_account_id,
    'booster_id', auth.uid(),
    'order_id', v_account.reserved_order_id,
    'login', v_payload->>'login',
    'password', v_payload->>'password',
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text, v_key, 'compress-algo=1, cipher-algo=aes256');

  -- Substitui qualquer token anterior desta conta -- só um token ativo por
  -- vez, mesma regra da 102 pra credenciais de pedido.
  update public.duo_accounts
  set access_token_id = v_token_id,
      access_token_expires_at = v_expires_at,
      access_token_consumed_at = null,
      updated_at = now()
  where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.access_token_issued', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true, 'access_token', encode(v_cipher, 'base64'), 'expires_at', v_expires_at);
end;
$$;


ALTER FUNCTION "public"."get_duo_account_access_token"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_duo_account_credentials"("p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_account record;
  v_key text;
  v_decrypted text;
  v_payload jsonb;
  v_parts text[];
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, encrypted_credentials into v_account
  from public.duo_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(decode(v_account.encrypted_credentials, 'base64'), v_key);
  exception when others then
    begin
      v_decrypted := pgp_sym_decrypt(v_account.encrypted_credentials::bytea, v_key);
    exception when others then
      return jsonb_build_object('success', false, 'error', 'decrypt_failed');
    end;
  end;

  begin
    v_payload := v_decrypted::jsonb;
    if nullif(v_payload->>'login', '') is null or nullif(v_payload->>'password', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
    end if;
  exception when others then
    v_parts := string_to_array(v_decrypted, '|');
    if array_length(v_parts, 1) < 2 then
      return jsonb_build_object('success', false, 'error', 'invalid_credentials_payload');
    end if;
    v_payload := jsonb_build_object('login', v_parts[1], 'password', v_parts[2]);
  end;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.credentials_viewed', 'duo_account', p_account_id::text);
  return jsonb_build_object('success', true, 'login', v_payload->>'login', 'password', v_payload->>'password');
end;
$$;


ALTER FUNCTION "public"."get_duo_account_credentials"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_duo_account_reservation_history"("p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select jsonb_build_object(
    'success', true,
    'stats', (
      select jsonb_build_object(
        'total_reservations', count(*),
        'total_seconds', coalesce(sum(extract(epoch from (coalesce(released_at, now()) - reserved_at))), 0),
        'distinct_boosters', count(distinct booster_id)
      )
      from public.duo_account_reservations where account_id = p_account_id
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'reserved_at', h.reserved_at,
        'released_at', h.released_at,
        'booster_id', h.booster_id,
        'booster_name', bp.display_name,
        'order_id', h.order_id,
        'order_service_type', o.service_type,
        'order_status', o.status
      ) order by h.reserved_at desc), '[]'::jsonb)
      from public.duo_account_reservations h
      left join public.booster_profiles bp on bp.user_id = h.booster_id
      left join public.orders o on o.id = h.order_id
      where h.account_id = p_account_id
      order by h.reserved_at desc
      limit 50
    )
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_duo_account_reservation_history"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_chat"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_messages jsonb := '[]'::jsonb;
begin
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

  if v_order.assigned_booster_id is not null then
    select coalesce(jsonb_agg(row_data order by row_data->>'created_at'), '[]'::jsonb)
    into v_messages
    from (
      select jsonb_build_object(
        'id', m.id,
        'order_id', m.order_id,
        'sender_id', m.sender_id,
        'sender_role', m.sender_role,
        'sender_name', case
          when m.sender_role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
          when m.sender_role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
          else coalesce(p.username, 'Cliente')
        end,
        'sender_avatar_url', p.avatar_url,
        'content', m.content,
        'created_at', m.created_at,
        'is_read', m.is_read
      ) as row_data
      from (
        select om.*
        from public.order_messages om
        where om.order_id = p_order_id
        order by om.created_at desc
        limit 300
      ) m
      join public.profiles p on p.id = m.sender_id
      left join public.booster_profiles bp
        on bp.user_id = m.sender_id
       and m.sender_role = 'booster'::public.user_role
    ) messages;
  end if;

  return jsonb_build_object(
    'success', true,
    'chat_available', v_order.assigned_booster_id is not null,
    'chat_locked', v_order.chat_locked,
    'chat_locked_at', v_order.chat_locked_at,
    'can_send',
      v_order.assigned_booster_id is not null
      and (v_role = 'admin'::public.user_role or not v_order.chat_locked),
    'messages', v_messages
  );
end;
$$;


ALTER FUNCTION "public"."get_order_chat"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_chat_mention_targets"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role    public.user_role;
  v_order   public.orders%rowtype;
  v_targets jsonb;
begin
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

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into v_targets
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', case
        when p.role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
        when p.role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
        else coalesce(p.username, 'Cliente')
      end,
      'role', p.role,
      'avatar_url', p.avatar_url
    ) as row_data
    from public.profiles p
    left join public.booster_profiles bp on bp.user_id = p.id and p.role = 'booster'::public.user_role
    where p.id <> v_user_id
      and (
        p.id = v_order.customer_id
        or p.id = v_order.assigned_booster_id
        or p.role = 'admin'::public.user_role
      )
  ) targets;

  return jsonb_build_object('success', true, 'targets', v_targets);
end;
$$;


ALTER FUNCTION "public"."get_order_chat_mention_targets"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_credentials"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_order record;
  v_requester uuid := auth.uid();
  v_key text;
  v_stored_payload jsonb;
  v_token_id uuid;
  v_token_expires_at timestamptz;
  v_new_payload text;
  v_new_cipher bytea;
begin
  if v_requester is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('get_order_credentials', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, game_credentials, credentials_set,
         credential_expires_at
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_requester is distinct from v_order.customer_id
     and v_requester is distinct from v_order.assigned_booster_id
     and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if not v_order.credentials_set or v_order.game_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  if v_order.credential_expires_at is null or v_order.credential_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired');
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_stored_payload := pgp_sym_decrypt(v_order.game_credentials::bytea, v_key)::jsonb;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end;

  v_token_id := gen_random_uuid();
  v_token_expires_at := now() + interval '5 minutes';

  v_new_payload := jsonb_build_object(
    'v', 3,
    'kind', 'riot_account_access',
    'token_id', v_token_id,
    'order_id', v_order.id,
    'customer_id', v_order.customer_id,
    'login', v_stored_payload->>'login',
    'password', v_stored_payload->>'password',
    'issued_at', now(),
    'expires_at', v_token_expires_at
  )::text;

  v_new_cipher := pgp_sym_encrypt(v_new_payload, v_key, 'compress-algo=1, cipher-algo=aes256');

  update public.orders
  set access_token_id = v_token_id,
      access_token_expires_at = v_token_expires_at,
      access_token_consumed_at = null,
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_requester, public.current_user_role(), 'order_credentials.token_created', 'order', p_order_id::text);

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_new_cipher, 'base64'),
    'expires_at', v_token_expires_at
  );
end;
$$;


ALTER FUNCTION "public"."get_order_credentials"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_customer_nickname"("p_order_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_username text;
begin
  select customer_id, assigned_booster_id into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  if v_order.assigned_booster_id is distinct from auth.uid() and not public.is_admin() then
    return null;
  end if;

  select username into v_username from public.profiles where id = v_order.customer_id;
  return v_username;
end;
$$;


ALTER FUNCTION "public"."get_order_customer_nickname"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_duo_account_history"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_own_entry jsonb;
  v_history jsonb;
begin
  select customer_id, assigned_booster_id, boost_mode, duo_own_riot_id
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_order.customer_id is distinct from auth.uid()
     and v_order.assigned_booster_id is distinct from auth.uid()
     and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.boost_mode is distinct from 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;

  v_own_entry := case when v_order.duo_own_riot_id is not null then
    jsonb_build_array(jsonb_build_object(
      'riot_id', v_order.duo_own_riot_id,
      'own_account', true,
      'reserved_at', null,
      'released_at', null
    ))
  else '[]'::jsonb end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'riot_id', coalesce(d.riot_id, d.label),
    'own_account', false,
    'reserved_at', h.reserved_at,
    'released_at', h.released_at
  ) order by h.reserved_at desc), '[]'::jsonb)
  into v_history
  from public.duo_account_reservations h
  join public.duo_accounts d on d.id = h.account_id
  where h.order_id = p_order_id;

  return jsonb_build_object('success', true, 'history', v_own_entry || v_history);
end;
$$;


ALTER FUNCTION "public"."get_order_duo_account_history"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_duo_partner_riot_id"("p_order_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
begin
  select customer_id, duo_own_riot_id into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  if v_order.customer_id is distinct from auth.uid() and not public.is_admin() then
    return null;
  end if;

  return coalesce(
    v_order.duo_own_riot_id,
    (select riot_id from public.duo_accounts where reserved_order_id = p_order_id)
  );
end;
$$;


ALTER FUNCTION "public"."get_order_duo_partner_riot_id"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") RETURNS TABLE("id" "uuid", "rating" smallint, "content" "text", "created_at" timestamp with time zone, "customer_nickname" "text", "service_type" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    r.id,
    r.rating,
    r.content,
    r.created_at,
    coalesce(p.username, 'Cliente EloPeak') as customer_nickname,
    o.service_type::text as service_type
  from public.reviews r
  join public.orders o on o.id = r.order_id
  left join public.profiles p on p.id = r.customer_id
  where r.booster_id = p_booster_id
    and r.is_public = true
  order by r.created_at desc
  limit 100;
$$;


ALTER FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_boosters"("p_service_type" "text" DEFAULT '__all__'::"text", "p_rank_bucket" "text" DEFAULT '__all__'::"text", "p_limit" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_min_candidates constant integer := 3;
  v_rows jsonb;
  v_segment_used text;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
    select
      bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
      bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
      bps.total_matches, bps.wins, bps.losses,
      round(bps.wins::numeric / nullif(bps.total_matches, 0) * 100, 1) as win_rate_pct,
      bps.average_kda, bps.review_count, bps.average_rating,
      bps.performance_score, bps.score_version, bps.updated_at
    from public.booster_performance_segments bps
    join public.booster_profiles bp on bp.user_id = bps.booster_id
    join public.profiles p on p.id = bp.user_id
    where bps.service_type = p_service_type and bps.rank_bucket = p_rank_bucket
      and bps.account_type = '__all__' and bps.queue_type = '__all__'
      and bp.status = 'approved'
    order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
    limit p_limit
  ) x;
  v_segment_used := 'exact';

  if p_rank_bucket <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.wins::numeric / nullif(bps.total_matches, 0) * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = p_service_type and bps.rank_bucket = '__all__'
        and bps.account_type = '__all__' and bps.queue_type = '__all__'
        and bp.status = 'approved'
      order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
      limit p_limit
    ) x;
    v_segment_used := 'service_type_only';
  end if;

  if p_service_type <> '__all__' and jsonb_array_length(v_rows) < least(p_limit, v_min_candidates) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
      select
        bps.booster_id, bp.id as booster_profile_id, bp.display_name, p.avatar_url, bp.current_rank,
        bps.service_type as segment_service_type, bps.rank_bucket as segment_rank_bucket,
        bps.total_matches, bps.wins, bps.losses,
        round(bps.wins::numeric / nullif(bps.total_matches, 0) * 100, 1) as win_rate_pct,
        bps.average_kda, bps.review_count, bps.average_rating,
        bps.performance_score, bps.score_version, bps.updated_at
      from public.booster_performance_segments bps
      join public.booster_profiles bp on bp.user_id = bps.booster_id
      join public.profiles p on p.id = bp.user_id
      where bps.service_type = '__all__' and bps.rank_bucket = '__all__'
        and bps.account_type = '__all__' and bps.queue_type = '__all__'
        and bp.status = 'approved'
      order by bps.performance_score desc, bps.total_matches desc, bps.review_count desc, bps.updated_at desc, bps.booster_id
      limit p_limit
    ) x;
    v_segment_used := 'global';
  end if;

  return jsonb_build_object(
    'success', true,
    'segment_used', v_segment_used,
    'requested_service_type', p_service_type,
    'requested_rank_bucket', p_rank_bucket,
    'score_version', 'v1',
    'boosters', v_rows
  );
end;
$$;


ALTER FUNCTION "public"."get_top_boosters"("p_service_type" "text", "p_rank_bucket" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_role       public.user_role;
  v_email      text;
  v_username   text;
  v_discord_id text;
begin
  v_role := case
    when new.raw_user_meta_data->>'role' = 'booster' then 'booster'::public.user_role
    else 'customer'::public.user_role
  end;

  v_email := coalesce(
    new.email,
    new.raw_user_meta_data->>'email',
    new.id::text || '@oauth.local'
  );

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

  v_discord_id := coalesce(
    new.raw_user_meta_data->>'provider_id',
    new.raw_user_meta_data->>'sub'
  );

  insert into public.profiles(id, email, role, username, discord_id)
  values (new.id, v_email, v_role, v_username, v_discord_id)
  on conflict (id) do update
    set discord_id = coalesce(excluded.discord_id, profiles.discord_id);

  if v_role = 'customer' then
    insert into public.customer_profiles(user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$_$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  )
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_approved_booster"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.booster_profiles
    where user_id = auth.uid() and status = 'approved'
  )
$$;


ALTER FUNCTION "public"."is_approved_booster"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_approved_booster"("p_booster_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.booster_profiles
    where user_id = p_booster_id and status = 'approved'
  )
$$;


ALTER FUNCTION "public"."is_approved_booster"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_customer_inactivity_reminder_targets"() RETURNS TABLE("customer_id" "uuid", "discord_id" "text", "last_order_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.discord_id, max(o.created_at)
  from public.profiles p
  join public.orders o on o.customer_id = p.id
  where p.role = 'customer'
    and p.discord_id is not null
    and (p.last_inactivity_dm_sent_at is null or p.last_inactivity_dm_sent_at < now() - interval '15 days')
  group by p.id, p.discord_id
  having max(o.created_at) < now() - interval '15 days';
$$;


ALTER FUNCTION "public"."list_customer_inactivity_reminder_targets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_duo_accounts"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_accounts jsonb;
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'game_id', d.game_id, 'label', d.label,
      'current_rank', d.current_rank, 'notes', d.notes, 'is_active', d.is_active,
      'created_by', d.created_by, 'created_at', d.created_at, 'updated_at', d.updated_at,
      'has_credentials', d.encrypted_credentials is not null,
      'reserved_by', d.reserved_by, 'reserved_order_id', d.reserved_order_id, 'reserved_at', d.reserved_at,
      'reserved_by_name', bp.display_name
    ) order by d.created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts d
    left join public.booster_profiles bp on bp.user_id = d.reserved_by;
  else
    select exists (
      select 1 from public.booster_profiles
      where user_id = auth.uid() and status = 'approved'
    ) into v_is_booster;

    if not v_is_booster then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'riot_id', riot_id, 'current_rank', current_rank, 'is_active', is_active,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts
    where is_active = true
      and encrypted_credentials is not null
      and public.duo_account_rank_is_valid(current_rank)
      and (reserved_by is null or reserved_by = auth.uid());
  end if;

  return jsonb_build_object('success', true, 'accounts', v_accounts);
end;
$$;


ALTER FUNCTION "public"."list_duo_accounts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_payout_reminder_targets"() RETURNS TABLE("booster_id" "uuid", "discord_id" "text", "available_balance" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select bp.user_id, p.discord_id, coalesce(sum(le.amount), 0) as available_balance
  from public.booster_profiles bp
  join public.profiles p on p.id = bp.user_id
  join public.booster_ledger_entries le on le.booster_id = bp.user_id
  where bp.status = 'approved'
    and p.discord_id is not null
  group by bp.user_id, p.discord_id
  having coalesce(sum(le.amount), 0) >= 50.00;
$$;


ALTER FUNCTION "public"."list_payout_reminder_targets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_customer_inactivity_reminder_sent"("p_customer_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.profiles set last_inactivity_dm_sent_at = now() where id = any(p_customer_ids);
$$;


ALTER FUNCTION "public"."mark_customer_inactivity_reminder_sent"("p_customer_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_order_chat_read"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
begin
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
$$;


ALTER FUNCTION "public"."mark_order_chat_read"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_order_match_sync"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.orders set last_match_synced_at = now() where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."mark_order_match_sync"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins_on_canceled_order_payment_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order_status public.order_status;
begin
  select status into v_order_status
  from public.orders
  where id = new.order_id;

  if v_order_status = 'canceled'::public.order_status
     and not exists (
       select 1
       from public.notifications
       where type = 'payment_approved_after_cancellation'
         and data->>'order_id' = new.order_id::text
     ) then
    insert into public.notifications(user_id, type, title, body, data)
    select
      id,
      'payment_approved_after_cancellation',
      'Pagamento aprovado após cancelamento',
      'O Mercado Pago aprovou o pagamento (' || case when new.metadata->>'method' = 'card' then 'cartão' else 'PIX' end
        || ') do pedido ' || new.order_id::text
        || ' depois de o pedido já estar cancelado. O pedido não foi reaberto; reconcilie o recebimento e o eventual reembolso manualmente.',
      jsonb_build_object(
        'order_id', new.order_id,
        'payment_id', new.id,
        'mp_payment_id', new.mp_payment_id,
        'amount', new.amount
      )
    from public.profiles
    where role = 'admin';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_admins_on_canceled_order_payment_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins_on_pending_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'pending_review' and old.status is distinct from 'pending_review' then
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'order_pending_review', 'Novo pedido em revisão',
           'Um pedido pago ficará disponível aos boosters após a janela administrativa.',
           jsonb_build_object('order_id', new.id, 'review_release_at', new.review_release_at)
    from public.profiles where role = 'admin';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_admins_on_pending_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_booster_profile_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.booster_profile_events(booster_id) values (new.user_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_booster_profile_changed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_boosters_order_available"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'awaiting_assignment' then
    if tg_op = 'INSERT' then
      insert into public.booster_order_events (order_id) values (new.id);
    elsif old.status is distinct from 'awaiting_assignment' then
      insert into public.booster_order_events (order_id) values (new.id);
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_boosters_order_available"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_discord_chat_mention"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'vault'
    AS $$
declare
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-chat-mention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'order_id', new.data->>'order_id',
      'body', new.body
    ),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_discord_chat_mention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_discord_order_webhook"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'vault'
    AS $$
declare
  v_payload jsonb;
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

  v_payload := jsonb_build_object(
    'record', jsonb_build_object(
      'id', new.id,
      'status', new.status,
      'discord_voice_channel_id', new.discord_voice_channel_id,
      'discord_text_channel_id', new.discord_text_channel_id
    ),
    'old_record', jsonb_build_object(
      'status', case when tg_op = 'UPDATE' then old.status else null end
    )
  );

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-order-channel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := v_payload,
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_discord_order_webhook"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_discord_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'vault'
    AS $$
declare
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-review-announcement',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object('review_id', new.id),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_discord_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_duo_account_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.duo_account_events(account_id) values (coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."notify_duo_account_changed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_order_status_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_events(order_id, status) values (new.id, new.status);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_order_status_changed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text" DEFAULT NULL::"text", "p_hours_per_day_min" integer DEFAULT NULL::integer, "p_hours_per_day_max" integer DEFAULT NULL::integer, "p_full_name" "text" DEFAULT NULL::"text", "p_cpf" "text" DEFAULT NULL::"text", "p_available_days" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role      public.user_role;
  v_email     text;
  v_bio       text := nullif(btrim(p_bio), '');
  v_opgg      text := nullif(btrim(p_opgg_link), '');
  v_full_name text := nullif(btrim(p_full_name), '');
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_tier      text := p_peak_rank->>'tier';
  v_booster_id uuid;
  v_is_new_application boolean;
begin
  v_is_new_application := not exists(select 1 from public.booster_profiles where user_id = auth.uid());

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
  if char_length(v_cpf_digits) <> 11 then
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
    updated_at        = now()
  returning id into v_booster_id;

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
$$;


ALTER FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text", "p_hours_per_day_min" integer, "p_hours_per_day_max" integer, "p_full_name" "text", "p_cpf" "text", "p_available_days" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order  record;
  v_latest record;
  v_from_step integer;
  v_to_step   integer;
  v_cur_step  integer;
begin
  select service_type, wins_played, wins_purchased, current_rank, target_rank, pdl_bracket
  into v_order from public.orders where id = p_order_id;

  if not found then return 0; end if;

  if v_order.service_type in ('win_boost', 'md5') then
    if coalesce(v_order.wins_purchased, 0) <= 0 then return 0; end if;
    return least(100, greatest(0,
      (coalesce(v_order.wins_played, 0)::numeric / v_order.wins_purchased::numeric) * 100
    ));
  end if;

  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null and v_order.target_rank is not null then
    select fetched_tier, fetched_division, passed into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;

    -- Master+ (PDL): sem corte ao vivo disponível aqui -- só considera
    -- concluído (100%) se a última verificação já bateu o alvo.
    if v_order.pdl_bracket is not null then
      if v_latest.passed is true then return 100; end if;
      return 0;
    end if;

    if v_latest.fetched_tier is null then return 0; end if;

    v_from_step := public.rank_step(v_order.current_rank->>'tier', v_order.current_rank->>'division');
    v_to_step   := public.rank_step(v_order.target_rank->>'tier', v_order.target_rank->>'division');
    v_cur_step  := public.rank_step(v_latest.fetched_tier, v_latest.fetched_division);

    if v_to_step <= v_from_step then return 0; end if;
    return least(100, greatest(0,
      ((v_cur_step - v_from_step)::numeric / (v_to_step - v_from_step)::numeric) * 100
    ));
  end if;

  -- Clash, Coaching, placement_matches: sem progresso gradual.
  return 0;
end;
$$;


ALTER FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_requires_access_token"("p_service_type" "public"."service_type", "p_boost_mode" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p_boost_mode, 'solo') = 'solo'
    and p_service_type in ('elo_boost', 'win_boost', 'md5', 'clash')
$$;


ALTER FUNCTION "public"."order_requires_access_token"("p_service_type" "public"."service_type", "p_boost_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payout_request_order_breakdown"("p_request_id" "uuid") RETURNS TABLE("order_id" "uuid", "service_type" "public"."service_type", "gross_amount" numeric, "commission_rate" numeric, "booster_commission" numeric, "amount_included" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_req record;
  v_prior_consumed numeric;
  v_running numeric := 0;
  v_remaining numeric;
  v_row record;
  v_amount_included numeric;
begin
  select * into v_req from public.payout_requests where id = p_request_id;
  if v_req is null or not (public.is_admin() or v_req.booster_id = auth.uid()) then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_prior_consumed
  from public.payout_requests
  where booster_id = v_req.booster_id
    and status not in ('rejected', 'canceled')
    and (created_at, id) < (v_req.created_at, v_req.id);

  v_remaining := v_req.amount;

  for v_row in (
    select pr.order_id as o_id, o.service_type as s_type, pr.gross_amount as g_amount,
           pr.commission_rate as c_rate, pr.net_amount as commission
    from public.payout_records pr
    join public.orders o on o.id = pr.order_id
    where pr.booster_id = v_req.booster_id
    order by pr.created_at asc
  ) loop
    v_running := v_running + v_row.commission;
    if v_running <= v_prior_consumed or v_remaining <= 0 then
      continue;
    end if;
    v_amount_included := least(v_row.commission, v_remaining, v_running - v_prior_consumed);
    v_remaining := v_remaining - v_amount_included;
    order_id := v_row.o_id;
    service_type := v_row.s_type;
    gross_amount := v_row.g_amount;
    commission_rate := v_row.c_rate;
    booster_commission := v_row.commission;
    amount_included := v_amount_included;
    return next;
  end loop;
end;
$$;


ALTER FUNCTION "public"."payout_request_order_breakdown"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.is_admin() or session_user <> current_user then
    return new;
  end if;

  if new.is_top3 is distinct from old.is_top3
     or new.total_earnings is distinct from old.total_earnings
     or new.rating is distinct from old.rating
     or new.rating_count is distinct from old.rating_count
     or new.blocked_until is distinct from old.blocked_until
     or new.suspended_until is distinct from old.suspended_until
     or new.verified_at is distinct from old.verified_at
     or new.total_completed is distinct from old.total_completed
  then
    raise exception 'only admins can change privileged booster_profiles columns';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_non_admin_booster_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if not public.is_admin() and new.status is distinct from old.status then
    raise exception 'only admins can change booster application status';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_non_admin_booster_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_mp_payment_event"("p_order_id" "uuid", "p_mp_payment_id" "text", "p_provider_status" "text", "p_amount" numeric, "p_currency" "text", "p_event_id" "text", "p_refund_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_payment_status public.payment_status;
  v_to_status public.order_status;
  v_requires_credentials boolean;
  v_booster_credit record;
begin
  if p_provider_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back') then
    return jsonb_build_object('success', true, 'ignored', true);
  end if;

  select * into v_order from public.orders
  where id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_order_mismatch'); end if;

  select * into v_payment from public.payments
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'payment_not_found'); end if;

  if p_event_id is not null and v_payment.webhook_event_id = p_event_id then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;

  if lower(p_currency) <> 'brl' or round(p_amount, 2) <> round(v_payment.amount, 2) then
    if not exists (
      select 1 from public.notifications
      where type = 'payment_amount_mismatch' and (data->>'order_id')::uuid = p_order_id
    ) then
      insert into public.notifications(user_id, type, title, body, data)
      select id, 'payment_amount_mismatch',
        'Pagamento com valor divergente',
        'Pedido ' || p_order_id::text || ' recebeu um pagamento MP de ' || p_currency || ' ' || p_amount::text
          || ', mas o valor esperado (registrado no pagamento) é R$ ' || v_payment.amount::text
          || '. O pedido está travado em aguardando pagamento até isso ser resolvido manualmente.',
        jsonb_build_object(
          'order_id', p_order_id, 'mp_payment_id', p_mp_payment_id,
          'expected_amount', v_payment.amount, 'received_amount', p_amount, 'received_currency', p_currency
        )
      from public.profiles where role = 'admin';
    end if;

    return jsonb_build_object('success', false, 'error', 'payment_reconciliation_failed');
  end if;

  v_payment_status := case
    when p_provider_status = 'approved' then 'paid'::public.payment_status
    when p_provider_status in ('rejected','cancelled') then 'failed'::public.payment_status
    when p_provider_status = 'refunded' then 'refunded'::public.payment_status
    when p_provider_status = 'charged_back' then 'disputed'::public.payment_status
    else 'pending'::public.payment_status
  end;

  update public.payments set
    status = v_payment_status,
    webhook_event_id = p_event_id,
    refunded_amount = case when p_provider_status = 'refunded' then amount else refunded_amount end,
    updated_at = now()
  where id = v_payment.id;

  if p_provider_status = 'approved' and v_order.status = 'awaiting_payment' then
    v_requires_credentials := public.order_requires_access_token(v_order.service_type, v_order.boost_mode);
    v_to_status := case
      when v_requires_credentials then 'awaiting_customer'::public.order_status
      else 'pending_review'::public.order_status
    end;

    update public.orders set
      status = v_to_status,
      payment_status = 'paid',
      review_release_at = case when not v_requires_credentials then now() + interval '2 minutes' else null end,
      updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, 'awaiting_payment', v_to_status, v_order.customer_id,
      case when v_requires_credentials
        then 'Pagamento PIX confirmado; aguardando credenciais do cliente'
        else 'Pagamento PIX confirmado via Mercado Pago; em revisão administrativa antes de ir pro pool'
      end
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'payment_confirmed',
      'PIX confirmado!',
      case when v_requires_credentials
        then 'Pagamento aprovado. Envie as credenciais para liberar o pedido aos boosters.'
        else 'Pagamento aprovado! Seu pedido está sendo processado e logo estará disponível para os boosters.'
      end,
      jsonb_build_object('order_id', p_order_id, 'requires_credentials', v_requires_credentials)
    );

    -- Alerta pro admin só no caminho que entra direto em pending_review (sem
    -- credenciais pendentes) -- o outro caminho (awaiting_customer) só vira
    -- pending_review depois que o cliente manda as credenciais, tratado por
    -- release_paid_order_after_credentials logo abaixo.
    if not v_requires_credentials then
      insert into public.notifications(user_id, type, title, body, data)
      select id, 'order_pending_review', 'Novo pedido pago -- em revisão',
        'Pedido ' || p_order_id::text || ' foi pago e está na janela de revisão. Disponibilize, analise, atribua ou cancele.',
        jsonb_build_object('order_id', p_order_id)
      from public.profiles where role = 'admin';

      perform net.http_post(
        url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-review-alert',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
          'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
        ),
        body := jsonb_build_object('order_id', p_order_id),
        timeout_milliseconds := 10000
      );
    end if;
  elsif p_provider_status in ('rejected','cancelled') and v_order.status = 'awaiting_payment' then
    update public.orders set
      status = 'canceled',
      payment_status = v_payment_status,
      updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, 'awaiting_payment', 'canceled', v_order.customer_id,
      case when p_provider_status = 'rejected'
        then 'Pagamento PIX recusado pelo Mercado Pago'
        else 'Pagamento PIX cancelado pelo Mercado Pago'
      end
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'order_status_changed',
      'Pagamento não concluído',
      'O pagamento deste pedido não foi concluído (' ||
        (case when p_provider_status = 'rejected' then 'recusado' else 'cancelado' end) ||
        ' pelo Mercado Pago). O pedido foi cancelado -- configure um novo pedido para tentar novamente.',
      jsonb_build_object('order_id', p_order_id)
    );
  elsif p_provider_status in ('refunded','charged_back')
        and v_order.status not in ('refunded','disputed') then
    v_to_status := case
      when p_provider_status = 'refunded' then 'refunded'::public.order_status
      else 'disputed'::public.order_status
    end;
    update public.orders set status = v_to_status, payment_status = v_payment_status, updated_at = now()
    where id = p_order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      p_order_id, v_order.status, v_to_status, v_order.customer_id,
      case when p_provider_status = 'refunded'
        then 'Pagamento reembolsado via Mercado Pago'
        else 'Chargeback recebido via Mercado Pago'
      end
    );
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id,
      'order_status_changed',
      case when p_provider_status = 'refunded' then 'Pedido reembolsado' else 'Pagamento contestado' end,
      case when p_provider_status = 'refunded' then 'Seu pedido foi reembolsado.' else 'Seu pagamento está em disputa.' end,
      jsonb_build_object('order_id', p_order_id)
    );
    if p_provider_status = 'refunded' then
      insert into public.refunds(payment_id, order_id, mp_refund_id, amount, reason, initiated_by, status)
      values (
        v_payment.id, p_order_id, coalesce(p_refund_id, p_mp_payment_id || '-refund'),
        v_order.total_price, 'Reembolso processado pelo Mercado Pago', v_order.customer_id, 'completed'
      )
      on conflict (mp_refund_id) do nothing;
    end if;

    if v_order.status = 'completed' then
      for v_booster_credit in
        select booster_id, coalesce(sum(amount), 0) as credited
        from public.booster_ledger_entries
        where order_id = p_order_id and entry_type = 'commission_credit'
        group by booster_id
        having coalesce(sum(amount), 0) > 0
      loop
        perform 1 from public.booster_profiles where user_id = v_booster_credit.booster_id for update;

        insert into public.booster_ledger_entries(
          booster_id, order_id, entry_type, amount, description, metadata
        ) values (
          v_booster_credit.booster_id, p_order_id, 'refund_debit', -v_booster_credit.credited,
          case when p_provider_status = 'refunded'
            then 'Estorno da comissão -- pedido reembolsado pelo Mercado Pago após conclusão'
            else 'Estorno da comissão -- chargeback recebido pelo Mercado Pago após conclusão'
          end,
          jsonb_build_object('mp_payment_id', p_mp_payment_id, 'provider_status', p_provider_status)
        );

        insert into public.notifications(user_id, type, title, body, data)
        values (
          v_booster_credit.booster_id,
          'commission_clawed_back',
          'Comissão estornada',
          case when p_provider_status = 'refunded'
            then 'O cliente foi reembolsado pelo Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_booster_credit.credited::text || ' foi estornada do seu saldo.'
            else 'Houve um chargeback no Mercado Pago após a conclusão do pedido. A comissão de R$ ' || v_booster_credit.credited::text || ' foi estornada do seu saldo.'
          end,
          jsonb_build_object('order_id', p_order_id, 'amount', v_booster_credit.credited)
        );

        insert into public.notifications(user_id, type, title, body, data)
        select id, 'commission_clawed_back_admin',
          'Estorno de comissão após pedido concluído',
          'Pedido ' || p_order_id::text || ' foi ' || (case when p_provider_status = 'refunded' then 'reembolsado' else 'contestado (chargeback)' end)
            || ' depois de já concluído. R$ ' || v_booster_credit.credited::text || ' foram estornados do saldo do booster -- confirme diretamente com ele se já houve saque desse valor.',
          jsonb_build_object('order_id', p_order_id, 'booster_id', v_booster_credit.booster_id, 'amount', v_booster_credit.credited)
        from public.profiles where role = 'admin';
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$_$;


ALTER FUNCTION "public"."process_mp_payment_event"("p_order_id" "uuid", "p_mp_payment_id" "text", "p_provider_status" "text", "p_amount" numeric, "p_currency" "text", "p_event_id" "text", "p_refund_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rank_bucket_of"("p_tier" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_tier in ('iron', 'bronze', 'silver', 'gold') then 'gold_minus'
    when p_tier in ('platinum', 'emerald', 'diamond') then 'plat_diamond'
    when p_tier in ('master', 'grandmaster', 'challenger') then 'master_plus'
    else '__all__'
  end
$$;


ALTER FUNCTION "public"."rank_bucket_of"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rank_step"("p_tier" "text", "p_division" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select case
    when p_tier = 'master' then 28
    when p_tier = 'grandmaster' then 29
    when p_tier = 'challenger' then 30
    else
      (array_position(array['iron','bronze','silver','gold','platinum','emerald','diamond'], p_tier) - 1) * 4
      + coalesce(array_position(array['IV','III','II','I'], p_division), 1) - 1
  end
$$;


ALTER FUNCTION "public"."rank_step"("p_tier" "text", "p_division" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_card_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  v_result := public.record_pix_payment(p_order_id, p_customer_id, p_mp_payment_id, p_amount);

  update public.payments
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('method', 'card')
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."record_card_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_duo_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss', 'remake') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.boost_mode <> 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  v_booster_id := coalesce(public.booster_assigned_at(p_order_id, p_played_at), v_order.assigned_booster_id);
  if v_booster_id is null then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'no_booster_assigned');
  end if;

  insert into public.booster_duo_matches(
    order_id, booster_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, v_booster_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;


ALTER FUNCTION "public"."record_duo_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_order_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer, "p_duo_participated" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_booster_id uuid;
  v_inserted boolean;
begin
  if p_result not in ('win', 'loss', 'remake') then
    return jsonb_build_object('success', false, 'error', 'invalid_result');
  end if;

  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status', 'inserted', false);
  end if;

  if v_order.boost_mode = 'duo' and p_result <> 'remake' and not coalesce(p_duo_participated, false) then
    return jsonb_build_object('success', true, 'inserted', false, 'skipped_reason', 'duo_not_participated');
  end if;

  v_booster_id := coalesce(public.booster_assigned_at(p_order_id, p_played_at), v_order.assigned_booster_id);

  insert into public.order_matches(
    order_id, booster_id, external_match_id, result, champion, kills, deaths, assists,
    queue_id, duration_seconds, played_at, minions_killed, neutral_minions_killed, is_mvp,
    vision_score
  ) values (
    p_order_id, v_booster_id, p_external_match_id, p_result, p_champion, p_kills, p_deaths, p_assists,
    p_queue_id, p_duration_seconds, p_played_at, p_minions_killed, p_neutral_minions_killed, p_is_mvp,
    p_vision_score
  )
  on conflict (order_id, external_match_id) do nothing;

  v_inserted := found;

  -- Só conta pro progresso/penalidade do pedido ATUAL se a partida é mesmo
  -- da janela de atribuição em aberto -- senão pertence a um booster que já
  -- foi desassociado (drop/reassign), e o contador que a penalidade de drop
  -- lê (apply_order_drop) não é dele.
  if v_inserted and v_booster_id = v_order.assigned_booster_id then
    if p_result = 'win' then
      update public.orders set wins_played = wins_played + 1, updated_at = now() where id = p_order_id;
    elsif p_result = 'loss' then
      update public.orders set losses_played = losses_played + 1, updated_at = now() where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'booster_id', v_booster_id);
end;
$$;


ALTER FUNCTION "public"."record_order_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer, "p_duo_participated" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_pix_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_order public.orders%rowtype;
  v_existing text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> p_customer_id then raise exception 'order mismatch'; end if;
  if round(v_order.total_price, 2) <> round(p_amount, 2) or p_amount <= 0 then raise exception 'amount mismatch'; end if;
  if v_order.mp_payment_id is not null and v_order.mp_payment_id <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  select mp_payment_id into v_existing from public.payments where order_id = p_order_id for update;
  if found and v_existing <> p_mp_payment_id then raise exception 'payment mismatch'; end if;

  update public.orders set mp_payment_id = p_mp_payment_id, updated_at = now() where id = p_order_id;
  insert into public.payments(order_id, customer_id, mp_payment_id, amount, currency, status, metadata)
  values (p_order_id, p_customer_id, p_mp_payment_id, round(p_amount, 2), 'brl', 'pending',
          jsonb_build_object('provider', 'mercadopago', 'mp_payment_id', p_mp_payment_id))
  on conflict (order_id) do update set updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."record_pix_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_booster_performance_segments"("p_booster_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  w_winrate constant numeric := 0.45;
  w_kda     constant numeric := 0.30;
  w_rating  constant numeric := 0.25;
  rating_prior        constant numeric := 4.5;
  rating_prior_weight constant numeric := 10;
  wilson_z constant numeric := 1.96;
begin
  delete from public.booster_performance_segments
  where p_booster_id is null or booster_id = p_booster_id;

  delete from public.booster_champion_stats
  where p_booster_id is null or booster_id = p_booster_id;

  with match_source as (
    select
      m.booster_id as assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      m.result, m.kills, m.deaths, m.assists, m.duration_seconds,
      m.minions_killed, m.neutral_minions_killed, m.is_mvp, m.champion, m.played_at,
      m.vision_score
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where m.booster_id is not null and o.boost_mode <> 'duo' and m.result in ('win', 'loss')
    union all
    select
      d.booster_id as assigned_booster_id, o.service_type, o.current_rank, o.boost_mode, o.queue_type,
      d.result, d.kills, d.deaths, d.assists, d.duration_seconds,
      d.minions_killed, d.neutral_minions_killed, d.is_mvp, d.champion, d.played_at,
      d.vision_score
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where d.booster_id is not null and o.boost_mode = 'duo' and d.result in ('win', 'loss')
  ),
  match_stats as (
    select
      ms.assigned_booster_id as booster_id, ms.service_type::text as service_type,
      null::text as rank_bucket,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      null::text as queue_type,
      count(*) as total_matches,
      count(*) filter (where ms.result = 'win') as wins,
      count(*) filter (where ms.result = 'loss') as losses,
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)) as average_kda,
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end) as avg_cs_per_min,
      avg(ms.vision_score) as avg_vision_score,
      count(*) filter (where ms.is_mvp) as mvp_count,
      max(ms.played_at) as last_match_at
    from match_source ms
    where p_booster_id is null or ms.assigned_booster_id = p_booster_id
    group by grouping sets (
      (ms.assigned_booster_id, ms.service_type),
      (ms.assigned_booster_id),
      (ms.assigned_booster_id, account_type)
    )

    union all

    select
      ms.assigned_booster_id, ms.service_type::text,
      public.rank_bucket_of(ms.current_rank->>'tier'),
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end,
      null::text,
      count(*),
      count(*) filter (where ms.result = 'win'),
      count(*) filter (where ms.result = 'loss'),
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)),
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end),
      avg(ms.vision_score),
      count(*) filter (where ms.is_mvp),
      max(ms.played_at)
    from match_source ms
    where (p_booster_id is null or ms.assigned_booster_id = p_booster_id)
      and public.rank_bucket_of(ms.current_rank->>'tier') <> '__all__'
    group by grouping sets (
      (ms.assigned_booster_id, ms.service_type, public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), public.rank_bucket_of(ms.current_rank->>'tier')),
      (ms.assigned_booster_id, public.rank_bucket_of(ms.current_rank->>'tier'))
    )

    union all

    select
      ms.assigned_booster_id, null::text,
      null::text,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end,
      ms.queue_type::text,
      count(*),
      count(*) filter (where ms.result = 'win'),
      count(*) filter (where ms.result = 'loss'),
      avg((ms.kills + ms.assists)::numeric / greatest(1, ms.deaths)),
      avg(case when ms.duration_seconds > 0 and ms.minions_killed is not null
        then (coalesce(ms.minions_killed, 0) + coalesce(ms.neutral_minions_killed, 0))::numeric / (ms.duration_seconds / 60.0)
        end),
      avg(ms.vision_score),
      count(*) filter (where ms.is_mvp),
      max(ms.played_at)
    from match_source ms
    where (p_booster_id is null or ms.assigned_booster_id = p_booster_id)
      and ms.queue_type is not null
    group by ms.assigned_booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), ms.queue_type::text
  ),
  match_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      total_matches, wins, losses, average_kda, avg_cs_per_min, avg_vision_score, mvp_count, last_match_at
    from match_stats
  ),
  review_stats as (
    select
      r.booster_id, o.service_type::text as service_type,
      null::text as rank_bucket,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      null::text as queue_type,
      count(*) as review_count,
      avg(r.rating) as average_rating
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
    group by grouping sets (
      (r.booster_id, o.service_type),
      (r.booster_id),
      (r.booster_id, account_type)
    )

    union all

    select
      r.booster_id, o.service_type::text,
      public.rank_bucket_of(o.current_rank->>'tier'),
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end,
      null::text,
      count(*),
      avg(r.rating)
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
      and public.rank_bucket_of(o.current_rank->>'tier') <> '__all__'
    group by grouping sets (
      (r.booster_id, o.service_type, public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, (case when o.boost_mode = 'duo' then 'duo' else 'solo' end), public.rank_bucket_of(o.current_rank->>'tier')),
      (r.booster_id, public.rank_bucket_of(o.current_rank->>'tier'))
    )

    union all

    select
      r.booster_id, null::text,
      null::text,
      case when o.boost_mode = 'duo' then 'duo' else 'solo' end,
      o.queue_type::text,
      count(*),
      avg(r.rating)
    from public.reviews r
    join public.orders o on o.id = r.order_id
    where r.is_public = true and r.booster_id is not null
      and (p_booster_id is null or r.booster_id = p_booster_id)
      and o.queue_type is not null
    group by r.booster_id, (case when o.boost_mode = 'duo' then 'duo' else 'solo' end), o.queue_type::text
  ),
  review_stats_normalized as (
    select
      booster_id,
      coalesce(service_type, '__all__') as service_type,
      coalesce(rank_bucket, '__all__') as rank_bucket,
      coalesce(account_type, '__all__') as account_type,
      coalesce(queue_type, '__all__') as queue_type,
      review_count, average_rating
    from review_stats
  ),
  merged as (
    select
      coalesce(m.booster_id, r.booster_id) as booster_id,
      coalesce(m.service_type, r.service_type) as service_type,
      coalesce(m.rank_bucket, r.rank_bucket) as rank_bucket,
      coalesce(m.account_type, r.account_type) as account_type,
      coalesce(m.queue_type, r.queue_type) as queue_type,
      coalesce(m.total_matches, 0) as total_matches,
      coalesce(m.wins, 0) as wins,
      coalesce(m.losses, 0) as losses,
      m.average_kda,
      m.avg_cs_per_min,
      m.avg_vision_score,
      coalesce(m.mvp_count, 0) as mvp_count,
      m.last_match_at,
      coalesce(r.review_count, 0) as review_count,
      r.average_rating
    from match_stats_normalized m
    full outer join review_stats_normalized r
      on r.booster_id = m.booster_id
     and r.service_type = m.service_type
     and r.rank_bucket = m.rank_bucket
     and r.account_type = m.account_type
     and r.queue_type = m.queue_type
  ),
  scored as (
    select
      *,
      case when total_matches = 0 then 0::numeric else
        (
          (wins::numeric / total_matches) + (wilson_z ^ 2) / (2 * total_matches::numeric)
          - wilson_z * sqrt(
              ((wins::numeric / total_matches) * (1 - wins::numeric / total_matches) / total_matches::numeric)
              + (wilson_z ^ 2) / (4 * (total_matches::numeric ^ 2))
            )
        ) / (1 + (wilson_z ^ 2) / total_matches::numeric)
      end as adjusted_win_rate_calc,
      coalesce(least(average_kda, 10) / 10, 0) as normalized_kda_calc,
      (review_count * coalesce(average_rating, rating_prior) + rating_prior_weight * rating_prior)
        / (review_count + rating_prior_weight) as adjusted_rating_calc
    from merged
  )
  insert into public.booster_performance_segments (
    booster_id, service_type, rank_bucket, account_type, queue_type,
    total_matches, wins, losses,
    adjusted_win_rate, average_kda, normalized_kda,
    avg_cs_per_min, avg_vision_score, mvp_count,
    review_count, average_rating, adjusted_rating,
    performance_score, score_version, last_match_at, calculated_at, updated_at
  )
  select
    booster_id, service_type, rank_bucket, account_type, queue_type,
    total_matches, wins, losses,
    adjusted_win_rate_calc,
    average_kda,
    normalized_kda_calc,
    avg_cs_per_min,
    avg_vision_score,
    mvp_count,
    review_count,
    round(average_rating::numeric, 2),
    adjusted_rating_calc,
    round((
      w_winrate * adjusted_win_rate_calc
      + w_kda * normalized_kda_calc
      + w_rating * (adjusted_rating_calc / 5)
    ) * 100, 2) as performance_score,
    'v1',
    last_match_at,
    now(),
    now()
  from scored
  where total_matches > 0 or review_count > 0;

  with match_source as (
    select m.booster_id, o.boost_mode, m.champion, m.result
    from public.order_matches m
    join public.orders o on o.id = m.order_id
    where m.booster_id is not null and o.boost_mode <> 'duo' and m.champion is not null and m.result in ('win', 'loss')
    union all
    select d.booster_id, o.boost_mode, d.champion, d.result
    from public.booster_duo_matches d
    join public.orders o on o.id = d.order_id
    where d.booster_id is not null and o.boost_mode = 'duo' and d.champion is not null and d.result in ('win', 'loss')
  ),
  champion_stats as (
    select
      ms.booster_id,
      case when ms.boost_mode = 'duo' then 'duo' else 'solo' end as account_type,
      ms.champion,
      count(*) as games_played,
      count(*) filter (where ms.result = 'win') as wins
    from match_source ms
    where p_booster_id is null or ms.booster_id = p_booster_id
    group by grouping sets (
      (ms.booster_id, (case when ms.boost_mode = 'duo' then 'duo' else 'solo' end), ms.champion),
      (ms.booster_id, ms.champion)
    )
  )
  insert into public.booster_champion_stats (booster_id, account_type, champion, games_played, wins, calculated_at)
  select booster_id, coalesce(account_type, '__all__'), champion, games_played, wins, now()
  from champion_stats;
end;
$$;


ALTER FUNCTION "public"."refresh_booster_performance_segments"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_booster_rating"("p_booster_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_avg   numeric(3,2);
  v_count integer;
begin
  select round(avg(rating)::numeric, 2), count(*)
  into   v_avg, v_count
  from   public.reviews
  where  booster_id = p_booster_id
    and  is_public = true;

  update public.booster_profiles
  set    rating       = coalesce(v_avg, 0),
         rating_count = coalesce(v_count, 0)
  where  user_id = p_booster_id;
end;
$$;


ALTER FUNCTION "public"."refresh_booster_rating"("p_booster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_top3_boosters"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_top3_ids uuid[];
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  select array_agg(sub.booster_id) into v_top3_ids
  from (
    select bps.booster_id
    from   public.booster_performance_segments bps
    join   public.booster_profiles bp on bp.user_id = bps.booster_id
    where  bps.service_type = '__all__'
      and  bps.rank_bucket = '__all__'
      and  bps.account_type = '__all__'
      and  bps.queue_type = '__all__'
      and  bp.status = 'approved'
      and  bp.total_completed >= 10
    order  by bps.performance_score desc, bp.total_completed desc, bps.booster_id
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;


ALTER FUNCTION "public"."refresh_top3_boosters"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_top3_boosters"() IS 'Recalcula os 3 boosters com maior performance_score (booster_performance_segments, linha rollup __all__/__all__/__all__/__all__, migration 054) entre os aprovados com >= 10 pedidos concluídos (booster_profiles.total_completed) e marca is_top3. Chamada só pelo cron job discord-top3-announcement (dias 15 e 30 de cada mês). Antes desta migration o piso de 10 pedidos era checado contra booster_performance_segments.completed_orders, coluna nunca escrita por refresh_booster_performance_segments -- ficava sempre em 0 e ninguém nunca virava Top3.';



CREATE OR REPLACE FUNCTION "public"."release_duo_account_reservation"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_account_id uuid;
begin
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
$$;


ALTER FUNCTION "public"."release_duo_account_reservation"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_paid_order_after_credentials"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.credentials_set = true
     and old.credentials_set = false
     and new.payment_status = 'paid'::public.payment_status
     and new.status = 'awaiting_customer'::public.order_status
     and new.assigned_booster_id is null
     and public.order_requires_access_token(new.service_type, new.boost_mode) then
    update public.orders
    set status = 'pending_review',
        review_release_at = now() + interval '2 minutes',
        updated_at = now()
    where id = new.id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (
      new.id, 'awaiting_customer', 'pending_review',  new.customer_id,
      'Credenciais enviadas; em revisão administrativa antes de ir pro pool'
    );

    insert into public.notifications(user_id, type, title, body, data)
    select id, 'order_pending_review', 'Novo pedido pago -- em revisão',
      'Pedido ' || new.id::text || ' recebeu as credenciais e está na janela de revisão. Disponibilize, analise, atribua ou cancele.',
      jsonb_build_object('order_id', new.id)
    from public.profiles where role = 'admin';

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-admin-review-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('order_id', new.id),
      timeout_milliseconds := 10000
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."release_paid_order_after_credentials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_pending_review_orders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id from public.orders
    where status = 'pending_review'
      and admin_review_locked = false
      and review_release_at <= now()
    for update skip locked
  loop
    perform public._release_pending_review_order(
      v_order_id, null, 'Liberado automaticamente após a janela de revisão de 2 minutos'
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."release_pending_review_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_booster_role"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_role is null or v_role not in ('customer', 'booster') then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."request_booster_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_customer_order_drop"("p_order_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_existing uuid;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, customer_id, assigned_booster_id, wins_played,
         losses_played, last_match_synced_at, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if coalesce(v_order.drop_count, 0) >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where order_id = p_order_id and status = 'pending';
  if found then
    return jsonb_build_object('success', false, 'error', 'drop_request_already_pending');
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, requested_by_role, status_at_request
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, 0, 0,
    'customer', v_order.status
  );

  update public.orders set status = 'drop_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop',
    'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'drop_request_pending_admin', 'Nova solicitação de drop',
         'Um cliente solicitou a troca de booster e aguarda aprovação.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."request_customer_order_drop"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_order_drop"("p_order_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_reason text := trim(p_reason);
  v_existing uuid;
begin
  if not public.check_own_write_rate_limit('request_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, assigned_booster_id, wins_played,
         losses_played, last_match_synced_at, drop_count
  into v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.service_type <> 'coaching' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if coalesce(v_order.drop_count, 0) >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where order_id = p_order_id and status = 'pending';
  if found then
    return jsonb_build_object('success', false, 'error', 'drop_request_already_pending');
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, requested_by_role, status_at_request
  ) values (
    p_order_id, auth.uid(), v_reason, v_order.wins_played, v_order.losses_played,
    0, 0, 'booster', v_order.status
  );

  update public.orders set status = 'drop_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  select id, 'drop_request_pending_admin', 'Nova solicitação de drop',
         'Um booster solicitou o drop de um pedido e aguarda aprovação.',
         jsonb_build_object('order_id', p_order_id)
  from public.profiles where role = 'admin';

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."request_order_drop"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_payout"("p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_booster record;
  v_available numeric;
  v_request_id uuid;
  v_min_amount constant numeric := 50.00;
  v_withdrawal_day int;
begin
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
$_$;


ALTER FUNCTION "public"."request_payout"("p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_duo_account"("p_order_id" "uuid", "p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_previous_account_id uuid;
  v_reserved_id uuid;
begin
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
$$;


ALTER FUNCTION "public"."reserve_duo_account"("p_order_id" "uuid", "p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_drop_request"("p_request_id" "uuid", "p_approve" boolean, "p_admin_note" "text" DEFAULT NULL::"text", "p_coaching_completion_pct" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
  v_order_status   public.order_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select status into v_order_status from public.orders where id = v_req.order_id for update;
  if v_order_status is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order_status <> 'drop_requested' then
    return jsonb_build_object('success', false, 'error', 'order_not_drop_requested');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    v_result := public.apply_order_drop(
      v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role,
      p_coaching_completion_pct
    );

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_amount = coalesce((v_result->>'payout_amount')::numeric, 0) - coalesce((v_result->>'penalty_amount')::numeric, 0),
           resolved_at = now()
    where  id = p_request_id;
  else
    v_restore_status := coalesce(v_req.status_at_request, 'in_progress');

    update public.orders set status = v_restore_status, updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', v_restore_status, auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));

    update public.order_drop_requests
    set    status      = 'rejected',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           resolved_at = now()
    where  id = p_request_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."resolve_drop_request"("p_request_id" "uuid", "p_approve" boolean, "p_admin_note" "text", "p_coaching_completion_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_duo_account_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_account_id uuid;
  v_token_id uuid;
  v_account record;
begin
  if p_booster_user_id is null
     or nullif(btrim(p_access_token), '') is null
     or char_length(p_access_token) > 8192 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  begin
    v_cipher := decode(p_access_token, 'base64');
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'credential_key' limit 1;
  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_payload := pgp_sym_decrypt(v_cipher, v_key)::jsonb;
    if v_payload->>'v' <> '2'
       or v_payload->>'kind' <> 'duo_account_access'
       or nullif(v_payload->>'login', '') is null
       or nullif(v_payload->>'password', '') is null
       or nullif(v_payload->>'token_id', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_account_id := (v_payload->>'account_id')::uuid;
    v_token_id := (v_payload->>'token_id')::uuid;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  if (v_payload->>'booster_id')::uuid is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;
  if (v_payload->>'expires_at')::timestamptz <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  if not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = p_booster_user_id and bp.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'booster_not_authorized');
  end if;

  select id, reserved_by, reserved_order_id, access_token_id, access_token_expires_at, access_token_consumed_at
  into v_account
  from public.duo_accounts where id = v_account_id for update;
  if not found or v_account.reserved_by is distinct from p_booster_user_id
     or v_account.reserved_order_id is distinct from (v_payload->>'order_id')::uuid then
    return jsonb_build_object('success', false, 'error', 'reservation_no_longer_valid');
  end if;

  -- Uso único: precisa ser exatamente o token_id ATIVO (não um já superado
  -- por uma emissão mais nova), nunca consumido antes, e ainda dentro da
  -- janela -- qualquer uma dessas condições falhando invalida.
  if v_account.access_token_id is distinct from v_token_id
     or v_account.access_token_consumed_at is not null
     or v_account.access_token_expires_at is null
     or v_account.access_token_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  -- Invalida imediatamente -- o mesmo token nunca mais resolve depois desta
  -- chamada, mesmo que a janela ainda não tenha esgotado.
  update public.duo_accounts
  set access_token_id = null,
      access_token_consumed_at = now(),
      updated_at = now()
  where id = v_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (p_booster_user_id, 'booster'::public.user_role, 'duo_account.access_token_resolved', 'duo_account', v_account_id::text);

  return jsonb_build_object(
    'success', true,
    'account_id', v_account_id,
    'login', v_payload->>'login',
    'password', v_payload->>'password'
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'invalid_token');
end;
$$;


ALTER FUNCTION "public"."resolve_duo_account_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_order_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_key text;
  v_cipher bytea;
  v_payload jsonb;
  v_order_id uuid;
  v_token_id uuid;
  v_order record;
begin
  if p_booster_user_id is null
     or nullif(btrim(p_access_token), '') is null
     or char_length(p_access_token) > 8192 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  begin
    v_cipher := decode(p_access_token, 'base64');
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select decrypted_secret
  into v_key
  from vault.decrypted_secrets
  where name = 'credential_key'
  limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_payload := pgp_sym_decrypt(v_cipher, v_key)::jsonb;
    if v_payload->>'v' <> '3'
       or v_payload->>'kind' <> 'riot_account_access'
       or nullif(v_payload->>'login', '') is null
       or nullif(v_payload->>'password', '') is null
       or nullif(v_payload->>'token_id', '') is null then
      return jsonb_build_object('success', false, 'error', 'invalid_token');
    end if;
    v_order_id := (v_payload->>'order_id')::uuid;
    v_token_id := (v_payload->>'token_id')::uuid;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end;

  select id, customer_id, assigned_booster_id, status, payment_status,
         service_type, boost_mode, access_token_id, access_token_expires_at,
         access_token_consumed_at
  into v_order
  from public.orders
  where id = v_order_id
    and assigned_booster_id = p_booster_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;

  if not exists (
    select 1
    from public.booster_profiles bp
    where bp.user_id = p_booster_user_id
      and bp.status = 'approved'
  ) then
    return jsonb_build_object('success', false, 'error', 'booster_not_authorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  -- Uso único: precisa ser exatamente o token ATIVO no momento (não um já
  -- superado por uma geração mais nova), nunca consumido antes, e ainda
  -- dentro dos 5 minutos -- qualquer uma dessas condições falhando invalida.
  if v_order.access_token_id is distinct from v_token_id
     or v_order.access_token_consumed_at is not null
     or v_order.access_token_expires_at is null
     or v_order.access_token_expires_at <= now()
     or (v_payload->>'expires_at')::timestamptz <= now()
     or (v_payload->>'customer_id')::uuid is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'token_expired_or_invalid');
  end if;

  -- Invalida imediatamente -- o mesmo token nunca mais resolve depois desta
  -- chamada, mesmo que a janela de 5 minutos ainda não tenha esgotado.
  update public.orders
  set access_token_id = null,
      access_token_consumed_at = now(),
      updated_at = now()
  where id = v_order.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (p_booster_user_id, 'booster'::public.user_role, 'order_credentials.resolved', 'order', v_order.id::text);

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'login', v_payload->>'login',
    'password', v_payload->>'password'
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'invalid_token');
end;
$$;


ALTER FUNCTION "public"."resolve_order_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_duo_account"("p_label" "text", "p_tier" "text", "p_division" "text", "p_is_active" boolean, "p_account_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text", "p_login" "text" DEFAULT NULL::"text", "p_password" "text" DEFAULT NULL::"text", "p_riot_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_id uuid;
  v_key text;
  v_rank jsonb;
  v_existing_credentials text;
  v_cipher text;
  v_is_create boolean := p_account_id is null;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if nullif(btrim(p_label), '') is null or char_length(btrim(p_label)) > 120 then
    return jsonb_build_object('success', false, 'error', 'invalid_label');
  end if;
  if p_riot_id is not null and char_length(btrim(p_riot_id)) > 40 then
    return jsonb_build_object('success', false, 'error', 'invalid_riot_id');
  end if;

  v_rank := jsonb_build_object('tier', lower(coalesce(p_tier, '')), 'division', upper(coalesce(p_division, '')));
  if not public.duo_account_rank_is_valid(v_rank) then
    return jsonb_build_object('success', false, 'error', 'rank_out_of_supported_range');
  end if;

  if (nullif(btrim(p_login), '') is null) <> (nullif(p_password, '') is null) then
    return jsonb_build_object('success', false, 'error', 'login_and_password_required_together');
  end if;
  if v_is_create and (nullif(btrim(p_login), '') is null or nullif(p_password, '') is null) then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;
  if nullif(btrim(p_login), '') is not null and (char_length(btrim(p_login)) > 160 or char_length(p_password) < 4 or char_length(p_password) > 256) then
    return jsonb_build_object('success', false, 'error', 'invalid_credentials');
  end if;

  if not v_is_create then
    select encrypted_credentials into v_existing_credentials
    from public.duo_accounts where id = p_account_id for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'account_not_found');
    end if;
  end if;

  if nullif(btrim(p_login), '') is not null then
    select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'credential_key' limit 1;
    if v_key is null or char_length(v_key) < 32 then
      return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
    end if;
    v_cipher := encode(pgp_sym_encrypt(jsonb_build_object(
      'v', 2, 'login', btrim(p_login), 'password', p_password
    )::text, v_key, 'compress-algo=1, cipher-algo=aes256'), 'base64');
  else
    v_cipher := v_existing_credentials;
  end if;

  if p_is_active and v_cipher is null then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;

  if v_is_create then
    insert into public.duo_accounts(
      game_id, label, current_rank, notes, encrypted_credentials, is_active, created_by, riot_id
    ) values (
      'lol', btrim(p_label), v_rank, nullif(btrim(p_notes), ''), v_cipher, p_is_active, auth.uid(), nullif(btrim(p_riot_id), '')
    ) returning id into v_id;
  else
    update public.duo_accounts set
      label = btrim(p_label), current_rank = v_rank,
      notes = nullif(btrim(p_notes), ''), encrypted_credentials = v_cipher,
      is_active = p_is_active, riot_id = coalesce(nullif(btrim(p_riot_id), ''), riot_id), updated_at = now()
    where id = p_account_id
    returning id into v_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(),
    case when v_is_create then 'duo_account.created' else 'duo_account.updated' end,
    'duo_account', v_id::text);

  return jsonb_build_object('success', true, 'account_id', v_id);
end;
$$;


ALTER FUNCTION "public"."save_duo_account"("p_label" "text", "p_tier" "text", "p_division" "text", "p_is_active" boolean, "p_account_id" "uuid", "p_notes" "text", "p_login" "text", "p_password" "text", "p_riot_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_order_message"("p_order_id" "uuid", "p_content" "text", "p_mentioned_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_message_id uuid;
  v_valid_mentions uuid[];
  v_mentioned_id uuid;
begin
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

  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'code', 'chat_unavailable', 'message', 'O chat sera liberado quando um booster for atribuido.');
  end if;

  if v_order.chat_locked and v_role <> 'admin'::public.user_role then
    return jsonb_build_object('success', false, 'code', 'chat_locked', 'message', 'O chat foi bloqueado pela administracao.');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'A mensagem deve ter entre 1 e 4000 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('order_chat_' || replace(p_order_id::text, '-', ''), 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  end if;

  -- Só marca de verdade quem é participante real do pedido (cliente, booster
  -- atribuído ou algum admin) e nunca o próprio remetente -- o payload vem do
  -- cliente, sem essa reconferência um usuário podia alegar ter mencionado
  -- qualquer uuid e gerar notificação/DM falsa pra alguém fora do pedido.
  select coalesce(array_agg(distinct t), '{}')
  into v_valid_mentions
  from unnest(coalesce(p_mentioned_user_ids, '{}')) as t
  where t <> v_user_id
    and (
      t = v_order.customer_id
      or t = v_order.assigned_booster_id
      or exists (select 1 from public.profiles where id = t and role = 'admin'::public.user_role)
    );

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read, mentioned_user_ids)
  values (p_order_id, v_user_id, v_role, v_content, false, v_valid_mentions)
  returning id into v_message_id;

  foreach v_mentioned_id in array v_valid_mentions loop
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_mentioned_id, 'chat_mention', 'Você foi mencionado',
      v_content,
      jsonb_build_object('order_id', p_order_id, 'message_id', v_message_id)
    );

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-chat-mention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('user_id', v_mentioned_id, 'order_id', p_order_id, 'body', v_content),
      timeout_milliseconds := 10000
    );
  end loop;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$$;


ALTER FUNCTION "public"."send_order_message"("p_order_id" "uuid", "p_content" "text", "p_mentioned_user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_booster_admin_note"("p_booster_id" "uuid", "p_note" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  insert into public.booster_admin_notes(booster_id, note, updated_at, updated_by)
  values (p_booster_id, coalesce(p_note, ''), now(), auth.uid())
  on conflict (booster_id) do update
    set note = excluded.note, updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."set_booster_admin_note"("p_booster_id" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_duo_account_active"("p_account_id" "uuid", "p_is_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_account record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  select id, current_rank, encrypted_credentials into v_account
  from public.duo_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if p_is_active and not public.duo_account_rank_is_valid(v_account.current_rank) then
    return jsonb_build_object('success', false, 'error', 'rank_out_of_supported_range');
  end if;
  if p_is_active and v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'credentials_required');
  end if;
  update public.duo_accounts set is_active = p_is_active, updated_at = now()
  where id = p_account_id;
  return jsonb_build_object('success', true, 'account_id', p_account_id, 'is_active', p_is_active);
end;
$$;


ALTER FUNCTION "public"."set_duo_account_active"("p_account_id" "uuid", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_duo_own_riot_id"("p_order_id" "uuid", "p_riot_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_trimmed text;
begin
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
$$;


ALTER FUNCTION "public"."set_duo_own_riot_id"("p_order_id" "uuid", "p_riot_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_master_plus_pricing_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_master_plus_pricing_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_order_coaching_topic_done"("p_order_id" "uuid", "p_topic_id" "uuid", "p_done" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
begin
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
$$;


ALTER FUNCTION "public"."set_order_coaching_topic_done"("p_order_id" "uuid", "p_topic_id" "uuid", "p_done" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_order_credentials"("p_order_id" "uuid", "p_login" "text", "p_password" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_order record;
  v_key text;
  v_payload text;
  v_cipher bytea;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('set_order_credentials', 10, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select id, customer_id, status, payment_status, service_type, boost_mode
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.payment_status is distinct from 'paid'::public.payment_status
     or v_order.status not in ('awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_paid_or_active');
  end if;

  if not public.order_requires_access_token(v_order.service_type, v_order.boost_mode) then
    return jsonb_build_object('success', false, 'error', 'credentials_not_required_for_service');
  end if;

  if nullif(btrim(p_login), '') is null or char_length(btrim(p_login)) > 160 then
    return jsonb_build_object('success', false, 'error', 'invalid_login');
  end if;

  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 256 then
    return jsonb_build_object('success', false, 'error', 'invalid_password');
  end if;

  select decrypted_secret
  into v_key
  from vault.decrypted_secrets
  where name = 'credential_key'
  limit 1;

  if v_key is null or char_length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  v_payload := jsonb_build_object(
    'v', 2,
    'kind', 'riot_account_access',
    'order_id', v_order.id,
    'customer_id', v_order.customer_id,
    'login', btrim(p_login),
    'password', p_password,
    'issued_at', now(),
    'expires_at', v_expires_at
  )::text;

  v_cipher := pgp_sym_encrypt(
    v_payload,
    v_key,
    'compress-algo=1, cipher-algo=aes256'
  );

  update public.orders
  set game_credentials = v_cipher::text,
      credentials_set = true,
      credential_expires_at = v_expires_at,
      updated_at = now()
  where id = v_order.id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), 'customer'::public.user_role, 'order_credentials.set', 'order', v_order.id::text);

  return jsonb_build_object(
    'success', true,
    'access_token', encode(v_cipher, 'base64'),
    'expires_at', v_expires_at
  );
end;
$$;


ALTER FUNCTION "public"."set_order_credentials"("p_order_id" "uuid", "p_login" "text", "p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_booster_active_on_accept"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if NEW.assigned_booster_id is not null
     and (OLD.assigned_booster_id is null or OLD.assigned_booster_id <> NEW.assigned_booster_id)
  then
    update public.booster_profiles
      set last_active_at = now()
      where user_id = NEW.assigned_booster_id;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_fn_booster_active_on_accept"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_booster_active_on_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if NEW.sender_role = 'booster' then
    update public.booster_profiles
      set last_active_at = now()
      where user_id = NEW.sender_id;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_fn_booster_active_on_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_cap_active_clash_orders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing boolean;
begin
  if new.service_type = 'clash' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 2));

    select exists (
      select 1 from public.orders
      where customer_id = new.customer_id
        and service_type = 'clash'
        and status not in ('completed', 'canceled', 'refunded')
    ) into v_existing;

    if v_existing then
      raise exception 'active_clash_order_exists' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_cap_active_clash_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_cap_coach_packages"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id
    and service_type = new.service_type
    and deleted_at is null;

  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_cap_coach_packages"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_fn_cap_coach_packages"() IS 'Limita cada booster a três serviços não arquivados; linhas com deleted_at preenchido preservam o histórico sem consumir uma vaga.';



CREATE OR REPLACE FUNCTION "public"."trg_fn_cap_pending_orders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  if new.status = 'awaiting_payment' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 1));

    select count(*) into v_count
    from public.orders
    where customer_id = new.customer_id and status = 'awaiting_payment';

    if v_count >= 2 then
      raise exception 'pending_order_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_cap_pending_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_days_remaining integer;
begin
  if new.display_name is distinct from old.display_name then
    if public.is_admin() then
      new.display_name_changed_at := now();
    elsif old.display_name_changed_at is not null
      and old.display_name_changed_at > now() - interval '30 days' then
      v_days_remaining := ceil(extract(epoch from ((old.display_name_changed_at + interval '30 days') - now())) / 86400);
      raise exception 'Você só pode alterar o nome de exibição novamente em 30 dias. Faltam % dia(s).', v_days_remaining
        using errcode = 'P0001';
    else
      new.display_name_changed_at := now();
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_enforce_message_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if not public.check_own_write_rate_limit('chat_message', 20, 60) then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_enforce_message_rate_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_enforce_review_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if not public.check_own_write_rate_limit('review_submit', 5, 60) then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_enforce_review_rate_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status          := old.status;
    new.total_completed := old.total_completed;
    new.total_earnings  := old.total_earnings;
    new.rating          := old.rating;
    new.rating_count    := old.rating_count;
    new.is_top3         := old.is_top3;
    new.verified_at     := old.verified_at;
    new.current_rank    := old.current_rank;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.total_orders := old.total_orders;
    new.total_spent  := old.total_spent;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_guard_notifications_user_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.user_id    := old.user_id;
    new.type       := old.type;
    new.title      := old.title;
    new.body       := old.body;
    new.data       := old.data;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_guard_notifications_user_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_guard_profiles_trust_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.username    := old.username;    -- só via RPC update_my_username (checa unicidade)
    new.email       := old.email;       -- vem do Discord OAuth
    new.discord_id  := old.discord_id;  -- vem do Discord OAuth
    new.role        := old.role;        -- reforço; já travado via WITH CHECK em profiles_update_own
    new.created_at  := old.created_at;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_guard_profiles_trust_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_lock_chat_on_order_completed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'completed' and old.status is distinct from new.status and not new.chat_locked then
    update public.orders
    set chat_locked = true,
        chat_locked_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_lock_chat_on_order_completed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_order_completed_booster_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_commission_rate   numeric(5,4);
  v_commission_amount numeric(10,2);
  v_net_amount        numeric(10,2);
  v_is_top3           boolean;
  v_payout_record_id  uuid;
begin
  if NEW.status = 'completed'
     and OLD.status is distinct from 'completed'
     and NEW.assigned_booster_id is not null
     and not exists (
       select 1 from public.payout_records
       where order_id = NEW.id and booster_id = NEW.assigned_booster_id
     )
  then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles
      where user_id = NEW.assigned_booster_id
      for update;

    v_commission_rate := case
      when NEW.service_type = 'coaching' then 0.30
      when v_is_top3 then 0.40
      else 0.45
    end;
    v_commission_amount := round(NEW.total_price * v_commission_rate, 2);
    v_net_amount := NEW.total_price - v_commission_amount;

    update public.booster_profiles
      set total_completed = total_completed + 1,
          total_earnings  = total_earnings + v_net_amount
      where user_id = NEW.assigned_booster_id;

    insert into public.payout_records(
      booster_id, order_id, gross_amount, commission_rate, commission_amount, net_amount, status
    ) values (
      NEW.assigned_booster_id, NEW.id, NEW.total_price, v_commission_rate, v_commission_amount, v_net_amount, 'pending'
    )
    returning id into v_payout_record_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description
    ) values (
      NEW.assigned_booster_id, NEW.id, 'commission_credit', v_net_amount,
      'Comissão do pedido ' || NEW.id::text || ' (' || (v_commission_rate::numeric * 100)::text || '% de comissão da plataforma) -- gerado automaticamente pelo trigger de conclusão de pedido'
    );
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_fn_order_completed_booster_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_fn_order_completed_booster_stats"() IS 'Ao concluir um pedido, credita o net_amount ao booster e registra o payout_record. Comissão da plataforma: 45% (booster normal, recebe 55%) ou 40% (booster Top3, recebe 60%) -- ver booster_profiles.is_top3.';



CREATE OR REPLACE FUNCTION "public"."trg_fn_order_paid_customer_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if NEW.payment_status = 'paid'::public.payment_status
     and OLD.payment_status is distinct from 'paid'::public.payment_status then
    update public.customer_profiles
      set total_orders = total_orders + 1,
          total_spent  = total_spent + NEW.total_price
      where user_id = NEW.customer_id;
  end if;

  -- Reverses the increment above when a previously-counted order (i.e. one
  -- that had already moved past draft/awaiting_payment, so it was actually
  -- added to the totals at some point) ends up canceled or refunded.
  -- OLD.status not in (..., 'canceled', 'refunded') also guards against
  -- ever reversing the same order's contribution twice.
  if NEW.status in ('canceled', 'refunded')
     and OLD.status not in ('draft', 'awaiting_payment', 'canceled', 'refunded') then
    update public.customer_profiles
      set total_orders = greatest(0, total_orders - 1),
          total_spent  = greatest(0, total_spent - NEW.total_price)
      where user_id = NEW.customer_id;
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trg_fn_order_paid_customer_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_release_duo_account_on_order_end"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status in ('completed', 'canceled', 'refunded', 'disputed') and old.status is distinct from new.status then
    update public.duo_accounts
    set reserved_by = null, reserved_order_id = null, reserved_at = null,
        last_released_by = reserved_by, last_released_at = now()
    where reserved_order_id = new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_release_duo_account_on_order_end"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if TG_OP = 'DELETE' then
    if old.booster_id is not null then
      perform public.refresh_booster_rating(old.booster_id);
      perform public.refresh_booster_performance_segments(old.booster_id);
    end if;
    return old;
  end if;

  if new.booster_id is not null then
    perform public.refresh_booster_rating(new.booster_id);
    perform public.refresh_booster_performance_segments(new.booster_id);
  end if;
  if TG_OP = 'UPDATE' and old.booster_id is not null and old.booster_id is distinct from new.booster_id then
    perform public.refresh_booster_rating(old.booster_id);
    perform public.refresh_booster_performance_segments(old.booster_id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booster_applications_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_booster_applications_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booster_professional_profile"("p_display_name" "text", "p_bio" "text", "p_peak_tier" "text", "p_opgg_link" "text", "p_opgg_link_visible" boolean, "p_available_days" "text"[], "p_hours_per_day_min" integer, "p_hours_per_day_max" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_bio          text := nullif(btrim(p_bio), '');
  v_opgg         text := nullif(btrim(p_opgg_link), '');
  v_current      record;
  v_days_remaining integer;
begin
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
$$;


ALTER FUNCTION "public"."update_booster_professional_profile"("p_display_name" "text", "p_bio" "text", "p_peak_tier" "text", "p_opgg_link" "text", "p_opgg_link_visible" boolean, "p_available_days" "text"[], "p_hours_per_day_min" integer, "p_hours_per_day_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booster_services_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_booster_services_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_duo_account_rank"("p_account_id" "uuid", "p_tier" "text", "p_division" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_account record;
begin
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
$$;


ALTER FUNCTION "public"."update_duo_account_rank"("p_account_id" "uuid", "p_tier" "text", "p_division" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_duo_accounts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_duo_accounts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_my_display_name"("p_display_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_display_name text := nullif(btrim(p_display_name), '');
  v_current_name text;
  v_days_remaining integer;
begin
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
$$;


ALTER FUNCTION "public"."update_my_display_name"("p_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.orders
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division, 'lp', p_lp)
  where id = p_order_id;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."update_order_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_duo_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.orders
  set duo_current_rank = jsonb_build_object('tier', p_tier, 'division', p_division, 'lp', p_lp)
  where id = p_order_id;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."update_order_duo_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order record;
  v_actor record;
  v_to_status public.order_status;
  v_allowed boolean := false;
  v_effective_wins integer;
  v_local_start timestamp;
  v_unlock_local timestamp;
  v_unlock_at timestamptz;
begin
  v_to_status := p_new_status::public.order_status;

  select id, status, assigned_booster_id, service_type, wins_purchased, wins_played,
         losses_played, match_sync_started_at, target_rank
  into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if public.is_admin() then
    if v_to_status in ('awaiting_assignment', 'pending_review', 'under_review') then
      return jsonb_build_object('success', false, 'error', 'use_admin_drop_order_instead');
    end if;

    select id, role into v_actor from public.profiles where id = auth.uid();

    update public.orders set status = v_to_status, updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_to_status, auth.uid(), coalesce(p_reason, 'Admin status update'));

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
            jsonb_build_object('from', v_order.status, 'to', v_to_status));

    return jsonb_build_object('success', true);
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.check_own_write_rate_limit('update_order_status', 20, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  v_allowed := case
    when v_order.status = 'assigned'          and v_to_status = 'in_progress' then true
    when v_order.status = 'in_progress'       and v_to_status in ('paused', 'awaiting_customer') then true
    when v_order.status = 'paused'            and v_to_status in ('in_progress', 'awaiting_customer') then true
    when v_order.status = 'awaiting_customer' and v_to_status in ('in_progress', 'paused') then true
    else false
  end;

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', 'invalid_transition');
  end if;

  if v_to_status = 'awaiting_customer' and v_order.service_type <> 'coaching' then
    if v_order.target_rank is not null then
      return jsonb_build_object('success', false, 'error', 'requires_rank_verification');
    end if;

    if v_order.service_type = 'clash' then
      if v_order.match_sync_started_at is null then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;

      v_local_start := v_order.match_sync_started_at at time zone 'America/Sao_Paulo';
      v_unlock_local := date_trunc('day', v_local_start) + interval '23 hours';
      if v_unlock_local < v_local_start then
        v_unlock_local := v_unlock_local + interval '1 day';
      end if;
      v_unlock_at := v_unlock_local at time zone 'America/Sao_Paulo';

      if now() < v_unlock_at then
        return jsonb_build_object('success', false, 'error', 'clash_completion_window_closed');
      end if;
    else
      if (v_order.wins_played + v_order.losses_played) < 1 then
        return jsonb_build_object('success', false, 'error', 'no_matches_played');
      end if;

      if v_order.wins_purchased is not null then
        v_effective_wins := case
          when v_order.service_type = 'win_boost' then v_order.wins_played - v_order.losses_played
          else v_order.wins_played
        end;
        if v_effective_wins < v_order.wins_purchased then
          return jsonb_build_object('success', false, 'error', 'objective_not_reached');
        end if;
      end if;
    end if;
  end if;

  update public.orders set
    status = v_to_status,
    updated_at = now(),
    match_sync_started_at = case
      when v_order.status = 'assigned' and v_to_status = 'in_progress'
        then coalesce(match_sync_started_at, now())
      else match_sync_started_at
    end
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, v_to_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;


ALTER FUNCTION "public"."update_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."win_price_cents"("p_queue" "public"."queue_type", "p_mode" "text", "p_tier" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select price_cents from public.win_price_cents_catalog where queue_type = p_queue and boost_mode = p_mode and tier = p_tier),
    (select price_cents from public.win_price_cents_catalog where queue_type = p_queue and boost_mode = p_mode and tier = 'master'),
    (select price_cents from public.win_price_cents_catalog where queue_type = 'solo_duo' and boost_mode = 'solo' and tier = 'diamond')
  );
$$;


ALTER FUNCTION "public"."win_price_cents"("p_queue" "public"."queue_type", "p_mode" "text", "p_tier" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "actor_role" "public"."user_role" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "diff" "jsonb",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_drop_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "wins_at_request" integer DEFAULT 0 NOT NULL,
    "losses_at_request" integer DEFAULT 0 NOT NULL,
    "penalty_pct" integer DEFAULT 0 NOT NULL,
    "penalty_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "admin_id" "uuid",
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "requested_by_role" "public"."drop_requester_role" DEFAULT 'booster'::"public"."drop_requester_role" NOT NULL,
    "status_at_request" "public"."order_status",
    CONSTRAINT "order_drop_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."order_drop_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."order_drop_requests"."penalty_pct" IS 'Renomeação em espírito, não em nome: % de conclusão do pedido no momento do drop (>=50 paga, <50 não paga) -- não é mais um percentual de multa. Nome da coluna preservado pra não quebrar leitores existentes.';



COMMENT ON COLUMN "public"."order_drop_requests"."penalty_amount" IS 'Valor PAGO ao booster (crédito, não desconto) por progresso parcial no pedido dropado -- 0 se completion_pct < 50%. Nome preservado por compatibilidade; ver comentário de penalty_pct.';



COMMENT ON COLUMN "public"."order_drop_requests"."requested_by_role" IS 'Quem originou o drop: booster (auto-solicitado), admin (drop direto) ou customer (cliente solicitou, precisa de aprovação igual ao de booster).';



COMMENT ON COLUMN "public"."order_drop_requests"."status_at_request" IS 'Status do pedido no momento em que a solicitação foi criada -- usado por resolve_drop_request para restaurar o status correto se a solicitação for rejeitada (antes sempre voltava pra in_progress, o que só era correto pra solicitações de booster, já que essas só partiam desse status).';



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "service_id" "text" NOT NULL,
    "game_id" "text" NOT NULL,
    "status" "public"."order_status" DEFAULT 'draft'::"public"."order_status" NOT NULL,
    "queue_type" "public"."queue_type" DEFAULT 'solo_duo'::"public"."queue_type" NOT NULL,
    "boost_mode" "text" DEFAULT 'solo'::"text" NOT NULL,
    "server" "text" NOT NULL,
    "current_rank" "jsonb",
    "target_rank" "jsonb",
    "wins_purchased" integer,
    "sessions_purchased" integer,
    "win_package" smallint,
    "extras" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "base_price" numeric(10,2) NOT NULL,
    "extras_price" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_price" numeric(10,2) NOT NULL,
    "estimated_hours" numeric(8,2),
    "customer_notes" "text",
    "wins_played" integer DEFAULT 0 NOT NULL,
    "losses_played" integer DEFAULT 0 NOT NULL,
    "assigned_booster_id" "uuid",
    "mp_payment_id" "text",
    "payment_status" "public"."payment_status",
    "game_credentials" "text",
    "credentials_set" boolean DEFAULT false NOT NULL,
    "discord_voice_channel_id" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_pdl" integer,
    "pdl_bracket" "text",
    "avg_pdl_gain" numeric(6,2),
    "avg_pdl_loss" numeric(6,2),
    "pricing_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "idempotency_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "used_exclusive_slot" boolean DEFAULT false NOT NULL,
    "riot_id" "text",
    "booster_service_id" "uuid",
    "preferred_booster_id" "uuid",
    "exclusive_until" timestamp with time zone,
    "service_type" "public"."service_type" NOT NULL,
    "chat_locked" boolean DEFAULT false NOT NULL,
    "chat_locked_by" "uuid",
    "chat_locked_at" timestamp with time zone,
    "credential_expires_at" timestamp with time zone,
    "match_sync_started_at" timestamp with time zone,
    "last_match_synced_at" timestamp with time zone,
    "access_token_id" "uuid",
    "access_token_expires_at" timestamp with time zone,
    "access_token_consumed_at" timestamp with time zone,
    "coupon_code" "text",
    "discount_price" numeric(10,2) DEFAULT 0 NOT NULL,
    "clash_tier" "public"."clash_tier",
    "clash_day" "public"."clash_day",
    "drop_count" integer DEFAULT 0 NOT NULL,
    "rank_before_last_drop" "jsonb",
    "last_dropped_at" timestamp with time zone,
    "duo_own_riot_id" "text",
    "discord_text_channel_id" "text",
    "customer_lanes" "text"[],
    "exclusive_expired_announced_at" timestamp with time zone,
    "reassigned_by_admin" boolean DEFAULT false NOT NULL,
    "review_release_at" timestamp with time zone,
    "admin_review_locked" boolean DEFAULT false NOT NULL,
    "duo_current_rank" "jsonb",
    "under_review_from_status" "public"."order_status",
    "under_review_started_at" timestamp with time zone,
    "awaiting_assignment_announced_at" timestamp with time zone,
    "awaiting_assignment_announce_attempted_at" timestamp with time zone,
    CONSTRAINT "orders_avg_pdl_gain_check" CHECK ((("avg_pdl_gain" IS NULL) OR ("avg_pdl_gain" > (0)::numeric))),
    CONSTRAINT "orders_avg_pdl_loss_check" CHECK ((("avg_pdl_loss" IS NULL) OR ("avg_pdl_loss" > (0)::numeric))),
    CONSTRAINT "orders_boost_mode_check" CHECK (("boost_mode" = ANY (ARRAY['solo'::"text", 'duo'::"text"]))),
    CONSTRAINT "orders_clash_fields_check" CHECK (((("service_type" = 'clash'::"public"."service_type") AND ("clash_tier" IS NOT NULL) AND ("clash_day" IS NOT NULL)) OR (("service_type" <> 'clash'::"public"."service_type") AND ("clash_tier" IS NULL) AND ("clash_day" IS NULL)))),
    CONSTRAINT "orders_credentials_consistency_check" CHECK (((("credentials_set" = true) AND ("game_credentials" IS NOT NULL) AND ("credential_expires_at" IS NOT NULL)) OR (("credentials_set" = false) AND ("game_credentials" IS NULL) AND ("credential_expires_at" IS NULL)))),
    CONSTRAINT "orders_current_pdl_check" CHECK ((("current_pdl" IS NULL) OR ("current_pdl" >= 0))),
    CONSTRAINT "orders_current_rank_required_check" CHECK ((("service_type" = ANY (ARRAY['clash'::"public"."service_type", 'coaching'::"public"."service_type", 'placement_matches'::"public"."service_type"])) OR ("current_rank" IS NOT NULL))),
    CONSTRAINT "orders_customer_lanes_valid" CHECK ((("customer_lanes" IS NULL) OR (("array_length"("customer_lanes", 1) <= 2) AND ("customer_lanes" <@ ARRAY['top'::"text", 'jungle'::"text", 'mid'::"text", 'bot'::"text", 'support'::"text"]) AND (("array_length"("customer_lanes", 1) < 2) OR ("customer_lanes"[1] IS DISTINCT FROM "customer_lanes"[2]))))),
    CONSTRAINT "orders_match_counters_nonnegative" CHECK ((("wins_played" >= 0) AND ("losses_played" >= 0))),
    CONSTRAINT "orders_pdl_bracket_check" CHECK ((("pdl_bracket" IS NULL) OR ("pdl_bracket" = ANY (ARRAY['0_49'::"text", '50_89'::"text", '90_119'::"text", '120_plus'::"text"])))),
    CONSTRAINT "orders_price_sum" CHECK (("total_price" = "round"((("base_price" + "extras_price") - "discount_price"), 2))),
    CONSTRAINT "orders_prices_nonnegative" CHECK ((("base_price" >= (0)::numeric) AND ("extras_price" >= (0)::numeric) AND ("discount_price" >= (0)::numeric) AND ("total_price" >= (0)::numeric))),
    CONSTRAINT "orders_win_package_check" CHECK (("win_package" = ANY (ARRAY[1, 3, 5])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."estimated_hours" IS 'Server-calculated estimated delivery duration in hours; supports fractional hours.';



COMMENT ON COLUMN "public"."orders"."idempotency_key" IS 'Obrigatória. Gerada pelo cliente (recomendado) ou pelo default do banco. Par único (customer_id, idempotency_key) via orders_customer_idempotency_idx -- ver create-pix-payment: um segundo insert com a mesma chave sempre reaproveita o pedido existente em vez de criar um novo.';



COMMENT ON COLUMN "public"."orders"."drop_count" IS 'Quantas vezes este pedido já foi dropado (booster/admin/cliente). > 0 é o sinal de "pedido já foi dropado antes" usado nos disclaimers de UI.';



COMMENT ON COLUMN "public"."orders"."rank_before_last_drop" IS 'Snapshot de current_rank tirado logo antes do último drop sobrescrevê-lo com o rank verificado mais recente. Só populado pra elo_boost. Permite mostrar o progresso que o booster anterior entregou (rank_before_last_drop -> current_rank), além do current_rank -> target_rank que já existia.';



COMMENT ON COLUMN "public"."orders"."last_dropped_at" IS 'Timestamp do último drop aplicado a este pedido (null se nunca dropado).';



COMMENT ON COLUMN "public"."orders"."reassigned_by_admin" IS 'true quando a reserva em preferred_booster_id veio de admin_reassign_booster (admin escolheu um booster pra um pedido), não de compra direta de perfil/coaching -- accept_boost_order ignora o limite de slots/exclusivo pra esse caso.';



COMMENT ON COLUMN "public"."orders"."review_release_at" IS 'Quando um pedido pending_review deve ser liberado automaticamente pro pool (now() + 2 minutos, calculado na entrada do status). Null fora de pending_review.';



COMMENT ON COLUMN "public"."orders"."admin_review_locked" IS 'true trava a liberação automática de um pedido pending_review -- só sai de pending_review quando o admin destravar/atribuir/cancelar manualmente.';



COMMENT ON COLUMN "public"."orders"."under_review_from_status" IS 'Status anterior de um pedido travado em análise mantendo o mesmo booster (Analisar sobre pedido ativo, sem apply_order_drop) -- usado por _release_pending_review_order pra restaurar o status certo ao liberar em vez de reabrir pro pool. Null fora desse caso.';



COMMENT ON COLUMN "public"."orders"."under_review_started_at" IS 'Quando a análise com booster preservado começou -- usado pra empurrar match_sync_started_at na liberação, "pausando" o prazo de entrega estimada pelo tempo que o pedido ficou travado. Null fora desse caso.';



CREATE OR REPLACE VIEW "public"."available_boost_orders" WITH ("security_barrier"='true') AS
 SELECT "id",
    "service_id",
    "game_id",
    "status",
    "queue_type",
    "boost_mode",
    "server",
    "current_rank",
    "target_rank",
    "wins_purchased",
    "sessions_purchased",
    "win_package",
    "extras",
    "total_price",
    "estimated_hours",
    "wins_played",
    "losses_played",
    "current_pdl",
    "pdl_bracket",
    "avg_pdl_gain",
    "avg_pdl_loss",
    "pricing_version",
    "created_at",
    "updated_at",
    "preferred_booster_id",
    "exclusive_until",
    "drop_count",
    "rank_before_last_drop",
    "last_dropped_at",
    "service_type",
    "clash_tier",
    "clash_day",
    "customer_lanes",
    "booster_service_id",
    "reassigned_by_admin",
    "riot_id",
    "assigned_booster_id",
    "match_sync_started_at"
   FROM "public"."orders"
  WHERE (("status" = 'awaiting_assignment'::"public"."order_status") AND ("assigned_booster_id" IS NULL) AND "public"."is_approved_booster"() AND ((NOT "public"."order_requires_access_token"("service_type", "boost_mode")) OR ("credentials_set" = true)) AND
        CASE
            WHEN ("service_type" = 'coaching'::"public"."service_type") THEN ("preferred_booster_id" = "auth"."uid"())
            ELSE (("preferred_booster_id" IS NULL) OR ("exclusive_until" IS NULL) OR ("exclusive_until" <= "now"()) OR ("preferred_booster_id" = "auth"."uid"()))
        END AND (("preferred_booster_id" = "auth"."uid"()) OR (NOT (EXISTS ( SELECT 1
           FROM "public"."order_drop_requests" "dr"
          WHERE (("dr"."order_id" = "orders"."id") AND ("dr"."booster_id" = "auth"."uid"()) AND ("dr"."status" = 'approved'::"text")))))));


ALTER VIEW "public"."available_boost_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booster_admin_notes" (
    "booster_id" "uuid" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."booster_admin_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."booster_admin_notes" IS 'Nota livre do admin sobre um booster. Um registro por booster (upsert via set_booster_admin_note) -- não é histórico/log, é o texto atual.';



CREATE TABLE IF NOT EXISTS "public"."booster_champion_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "account_type" "text" DEFAULT '__all__'::"text" NOT NULL,
    "champion" "text" NOT NULL,
    "games_played" integer DEFAULT 0 NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booster_champion_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booster_duo_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "external_match_id" "text" NOT NULL,
    "result" "text" NOT NULL,
    "champion" "text",
    "kills" integer DEFAULT 0 NOT NULL,
    "deaths" integer DEFAULT 0 NOT NULL,
    "assists" integer DEFAULT 0 NOT NULL,
    "queue_id" integer,
    "duration_seconds" integer,
    "played_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "minions_killed" integer,
    "neutral_minions_killed" integer,
    "is_mvp" boolean DEFAULT false NOT NULL,
    "vision_score" integer,
    CONSTRAINT "booster_duo_matches_result_check" CHECK (("result" = ANY (ARRAY['win'::"text", 'loss'::"text", 'remake'::"text"])))
);


ALTER TABLE "public"."booster_duo_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booster_ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "payout_request_id" "uuid",
    "entry_type" "public"."ledger_entry_type" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_role" "public"."user_role",
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booster_ledger_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."booster_ledger_entries" IS 'Ledger financeiro imutável do booster. available_balance = soma bruta de amount de todos os lançamentos -- todo INSERT já grava o sinal correto (créditos positivos, débitos negativos). Sem policy de UPDATE/DELETE para nenhum papel -- só é escrito por funções SECURITY DEFINER.';



CREATE TABLE IF NOT EXISTS "public"."booster_order_events" (
    "id" bigint NOT NULL,
    "order_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booster_order_events" OWNER TO "postgres";


ALTER TABLE "public"."booster_order_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."booster_order_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."booster_performance_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "service_type" "text" DEFAULT '__all__'::"text" NOT NULL,
    "rank_bucket" "text" DEFAULT '__all__'::"text" NOT NULL,
    "total_matches" integer DEFAULT 0 NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "losses" integer DEFAULT 0 NOT NULL,
    "adjusted_win_rate" numeric(6,5) DEFAULT 0 NOT NULL,
    "average_kda" numeric(6,3),
    "normalized_kda" numeric(6,5) DEFAULT 0 NOT NULL,
    "review_count" integer DEFAULT 0 NOT NULL,
    "average_rating" numeric(3,2),
    "adjusted_rating" numeric(6,5) DEFAULT 0,
    "performance_score" numeric(6,2) DEFAULT 0 NOT NULL,
    "score_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "last_match_at" timestamp with time zone,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_type" "text" DEFAULT '__all__'::"text" NOT NULL,
    "queue_type" "text" DEFAULT '__all__'::"text" NOT NULL,
    "avg_cs_per_min" numeric(6,2),
    "mvp_count" integer DEFAULT 0 NOT NULL,
    "avg_vision_score" numeric(6,2),
    "completed_orders" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."booster_performance_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booster_profile_events" (
    "id" bigint NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booster_profile_events" OWNER TO "postgres";


ALTER TABLE "public"."booster_profile_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."booster_profile_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."booster_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "status" "public"."booster_status" DEFAULT 'pending'::"public"."booster_status" NOT NULL,
    "bio" "text",
    "peak_rank" "jsonb",
    "current_rank" "jsonb",
    "games" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "lanes" "text"[],
    "specialties" "text"[],
    "available_days" "text"[],
    "total_completed" integer DEFAULT 0 NOT NULL,
    "total_earnings" numeric(10,2) DEFAULT 0 NOT NULL,
    "rating" numeric(3,2) DEFAULT 0 NOT NULL,
    "rating_count" integer DEFAULT 0 NOT NULL,
    "is_top3" boolean DEFAULT false NOT NULL,
    "last_active_at" timestamp with time zone,
    "opgg_link" "text",
    "hours_per_day_min" smallint,
    "hours_per_day_max" smallint,
    "full_name" "text",
    "email" "text",
    "cpf" "text",
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name_changed_at" timestamp with time zone,
    "suspended_until" timestamp with time zone,
    "opgg_link_visible" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."booster_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."booster_profiles"."display_name_changed_at" IS 'Quando display_name foi alterado pela última vez -- controla o cooldown de 30 dias (trg_fn_enforce_booster_display_name_cooldown, migration 025). Null = nunca alterado desde que esta coluna existe; próxima troca é sempre permitida nesse caso.';



COMMENT ON COLUMN "public"."booster_profiles"."suspended_until" IS 'When a manual 24h suspension (approve_booster with status=suspended) auto-expires. Null = not suspended, or suspended with no expiry (legacy rows predating this column). Distinct from blocked_until, which is the unrelated automatic drop-warning throttle on taking NEW orders.';



CREATE TABLE IF NOT EXISTS "public"."booster_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "tempo" "text" NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "service_type" "text",
    "unit" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "requirements" "text",
    "availability_note" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "rules" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lanes" "text"[],
    "specialties" "text"[],
    "champions" "text"[],
    "deleted_at" timestamp with time zone,
    CONSTRAINT "booster_services_champions_no_digits" CHECK ((("champions" IS NULL) OR ("array_to_string"("champions", ','::"text") !~ '[[:digit:]]'::"text"))),
    CONSTRAINT "booster_services_champions_valid" CHECK ((("champions" IS NULL) OR ((("array_length"("champions", 1) >= 1) AND ("array_length"("champions", 1) <= 3)) AND (NOT ("champions" && ARRAY[''::"text"]))))),
    CONSTRAINT "booster_services_description_nonempty" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "booster_services_lanes_valid" CHECK ((("lanes" IS NOT NULL) AND (("array_length"("lanes", 1) >= 1) AND ("array_length"("lanes", 1) <= 2)) AND ("lanes" <@ ARRAY['top'::"text", 'jungle'::"text", 'mid'::"text", 'bot'::"text", 'support'::"text"]))),
    CONSTRAINT "booster_services_price_ceiling" CHECK (("price" <= (10000)::numeric)),
    CONSTRAINT "booster_services_price_positive" CHECK (("price" > (0)::numeric)),
    CONSTRAINT "booster_services_specialties_valid" CHECK ((("specialties" IS NOT NULL) AND (("array_length"("specialties", 1) >= 1) AND ("array_length"("specialties", 1) <= 5)) AND (NOT ("specialties" && ARRAY[''::"text"])))),
    CONSTRAINT "booster_services_tempo_nonempty" CHECK (("btrim"("tempo") <> ''::"text")),
    CONSTRAINT "booster_services_title_nonempty" CHECK (("btrim"("title") <> ''::"text"))
);


ALTER TABLE "public"."booster_services" OWNER TO "postgres";


COMMENT ON TABLE "public"."booster_services" IS 'Ofertas de serviço do booster (até 3 no total, entre qualquer tipo — ver trigger trg_fn_cap_coach_packages, migration 023) — apesar do nome legado, service_type não é mais exclusivamente ''coaching''; a UI (BoosterServicesList.tsx) permite qualquer tipo de serviço.';



COMMENT ON COLUMN "public"."booster_services"."deleted_at" IS 'Soft delete: null enquanto disponível no catálogo; preenchido quando o booster exclui o serviço.';



CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "country" "text",
    "preferred_language" "text" DEFAULT 'en'::"text",
    "total_orders" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."duo_account_events" (
    "id" bigint NOT NULL,
    "account_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."duo_account_events" OWNER TO "postgres";


ALTER TABLE "public"."duo_account_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."duo_account_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."duo_account_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "booster_id" "uuid" NOT NULL,
    "reserved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "released_at" timestamp with time zone,
    "released_by" "uuid"
);


ALTER TABLE "public"."duo_account_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."duo_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text" DEFAULT 'lol'::"text" NOT NULL,
    "label" "text" NOT NULL,
    "current_rank" "jsonb",
    "notes" "text",
    "encrypted_credentials" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reserved_by" "uuid",
    "reserved_order_id" "uuid",
    "reserved_at" timestamp with time zone,
    "riot_id" "text",
    "last_released_by" "uuid",
    "last_released_at" timestamp with time zone,
    "access_token_id" "uuid",
    "access_token_expires_at" timestamp with time zone,
    "access_token_consumed_at" timestamp with time zone,
    CONSTRAINT "duo_accounts_active_rank_valid" CHECK (((NOT "is_active") OR "public"."duo_account_rank_is_valid"("current_rank")))
);


ALTER TABLE "public"."duo_accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."duo_accounts" IS 'Contas duo (credenciais/rank/reserva). Acesso de authenticated/anon é RPC-only por design -- list_duo_accounts()/save_duo_account()/reserve_duo_account() etc, todas SECURITY DEFINER. Não há grant de SELECT de tabela nem por coluna pra authenticated/anon; as policies RLS (duo_accounts_read/_admin_insert/update/delete) existem como defesa em profundidade caso um grant de coluna seja adicionado no futuro.';



COMMENT ON COLUMN "public"."duo_accounts"."notes" IS 'Observações internas do admin sobre a conta. SELECT direto da coluna é revogado de authenticated/anon (migration 138) -- leitura só acontece dentro de list_duo_accounts() (branch admin) e get_duo_account_credentials(), RPCs SECURITY DEFINER que rodam como owner.';



COMMENT ON COLUMN "public"."duo_accounts"."encrypted_credentials" IS 'Ciphertext PGP (pgp_sym_encrypt), chave em Supabase Vault. SELECT direto da coluna é revogado de authenticated/anon -- leitura só acontece dentro de RPCs SECURITY DEFINER (get_duo_account_credentials para admin, get_duo_account_access_token/resolve_duo_account_access_token para o booster com a conta reservada), que rodam como owner e ignoram GRANTs de coluna do chamador.';



COMMENT ON COLUMN "public"."duo_accounts"."created_by" IS 'Admin que cadastrou a conta. Mesmo tratamento de notes -- SELECT direto revogado de authenticated/anon (migration 138), só legível via RPC admin.';



CREATE TABLE IF NOT EXISTS "public"."edge_rate_limits" (
    "scope" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer NOT NULL,
    CONSTRAINT "edge_rate_limits_request_count_check" CHECK (("request_count" > 0))
);


ALTER TABLE "public"."edge_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."master_plus_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "price" numeric(10,2),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "current_tier" "text" NOT NULL,
    "target_tier" "text" NOT NULL,
    "queue_type" "public"."queue_type" NOT NULL,
    "pdl_from" integer NOT NULL,
    "boost_mode" "text" NOT NULL,
    CONSTRAINT "master_plus_price_positive" CHECK ((("price" IS NULL) OR ("price" > (0)::numeric))),
    CONSTRAINT "master_plus_pricing_boost_mode_check" CHECK (("boost_mode" = ANY (ARRAY['solo'::"text", 'duo'::"text"]))),
    CONSTRAINT "master_plus_pricing_pdl_from_check" CHECK (("pdl_from" >= 0)),
    CONSTRAINT "master_plus_pricing_progression_check" CHECK (((("current_tier" = 'master'::"text") AND ("target_tier" = ANY (ARRAY['grandmaster'::"text", 'challenger'::"text"]))) OR (("current_tier" = 'grandmaster'::"text") AND ("target_tier" = 'challenger'::"text"))))
);


ALTER TABLE "public"."master_plus_pricing" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_plus_pricing" IS 'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo, fila, degrau de PDL, modalidade). SoloQ ainda varia por PDL (degraus de 300, mais barato quanto mais perto do corte do próximo tier); Flex tem um único preço fixo por par de tier (pdl_from=0), sem desconto por PDL. Duo só existe pra fila Flex (Riot não restringe duo por elo lá; Solo/Duo segue sem Duo Boost em Master+, ver shared/boostDomain.ts getBoostFlow). Lookup: maior pdl_from <= PDL atual do cliente para o par/fila/modalidade; PDL acima do último degrau usa o preço do último (nunca fica sem preço). updated_by não tem FK pra profiles de propósito -- tabela de configuração comercial pura, não pode ser apagada por um truncate/cleanup de dados de usuário.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_booster_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unassigned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_booster_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_coaching_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "is_done" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_by_role" "public"."user_role" NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_coaching_topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_ignored_matches" (
    "order_id" "uuid" NOT NULL,
    "external_match_id" "text" NOT NULL,
    "ignored_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_ignored_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "external_match_id" "text" NOT NULL,
    "result" "text" NOT NULL,
    "champion" "text",
    "kills" integer DEFAULT 0 NOT NULL,
    "deaths" integer DEFAULT 0 NOT NULL,
    "assists" integer DEFAULT 0 NOT NULL,
    "queue_id" integer,
    "duration_seconds" integer,
    "played_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "minions_killed" integer,
    "neutral_minions_killed" integer,
    "is_mvp" boolean DEFAULT false NOT NULL,
    "vision_score" integer,
    "booster_id" "uuid",
    CONSTRAINT "order_matches_result_check" CHECK (("result" = ANY (ARRAY['win'::"text", 'loss'::"text", 'remake'::"text"])))
);


ALTER TABLE "public"."order_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "sender_role" "public"."user_role" NOT NULL,
    "content" "text" NOT NULL,
    "attachment_url" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mentioned_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "order_messages_content_length" CHECK ((("char_length"("btrim"("content")) >= 1) AND ("char_length"("btrim"("content")) <= 4000)))
);


ALTER TABLE "public"."order_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."order_messages"."mentioned_user_ids" IS 'Participantes do pedido (cliente/booster/admin) marcados com @ nesta mensagem -- dispara notificação chat_mention + DM no Discord pra cada um.';



CREATE TABLE IF NOT EXISTS "public"."order_rank_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "riot_id_checked" "text" NOT NULL,
    "fetched_tier" "text",
    "fetched_division" "text",
    "target_tier" "text" NOT NULL,
    "target_division" "text",
    "passed" boolean NOT NULL,
    "error_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fetched_lp" integer
);


ALTER TABLE "public"."order_rank_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_status_events" (
    "id" bigint NOT NULL,
    "order_id" "uuid" NOT NULL,
    "status" "public"."order_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_status_events" OWNER TO "postgres";


ALTER TABLE "public"."order_status_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."order_status_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "from_status" "public"."order_status",
    "to_status" "public"."order_status" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_status_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "mp_payment_id" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'brl'::"text" NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "payment_method_type" "text",
    "webhook_event_id" "text",
    "refunded_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_positive" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payments_refund_range" CHECK ((("refunded_amount" >= (0)::numeric) AND ("refunded_amount" <= "amount")))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "gross_amount" numeric(10,2) NOT NULL,
    "commission_rate" numeric(5,4) DEFAULT 0.45 NOT NULL,
    "commission_amount" numeric(10,2) NOT NULL,
    "net_amount" numeric(10,2) NOT NULL,
    "status" "public"."payout_status" DEFAULT 'pending'::"public"."payout_status" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_amounts_nonnegative" CHECK ((("gross_amount" >= (0)::numeric) AND ("commission_amount" >= (0)::numeric) AND ("net_amount" >= (0)::numeric) AND (("commission_rate" >= (0)::numeric) AND ("commission_rate" <= (1)::numeric))))
);


ALTER TABLE "public"."payout_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booster_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "public"."payout_request_status" DEFAULT 'requested'::"public"."payout_request_status" NOT NULL,
    "booster_cpf_snapshot" "text",
    "booster_legal_name_snapshot" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "admin_note" "text",
    "rejection_reason" "text",
    "proof_url" "text",
    "paid_at" timestamp with time zone,
    "paid_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_requests_amount_positive" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payout_requests_paid_requires_proof" CHECK ((("status" <> 'paid'::"public"."payout_request_status") OR ("proof_url" IS NOT NULL)))
);


ALTER TABLE "public"."payout_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."user_role" DEFAULT 'customer'::"public"."user_role" NOT NULL,
    "username" "text" NOT NULL,
    "avatar_url" "text",
    "discord_id" "text",
    "terms_accepted_at" timestamp with time zone,
    "privacy_accepted_at" timestamp with time zone,
    "legal_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_inactivity_dm_sent_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."last_inactivity_dm_sent_at" IS 'Última vez que o cron discord-customer-inactivity-reminder mandou o DM de reengajamento -- evita repetir o lembrete todo dia enquanto o cliente continuar inativo (repete só a cada 15 dias).';



CREATE OR REPLACE VIEW "public"."public_booster_profiles" AS
 SELECT "bp"."id",
    "bp"."user_id",
    "bp"."display_name",
    "bp"."bio",
    "bp"."current_rank",
    "bp"."peak_rank",
    "bp"."games",
    "bp"."rating",
    "bp"."rating_count",
    "bp"."total_completed",
    "bp"."is_top3",
    "bp"."last_active_at",
    "bp"."updated_at",
    "bp"."lanes",
    "bp"."specialties",
    "p"."avatar_url",
        CASE
            WHEN "bp"."opgg_link_visible" THEN "bp"."opgg_link"
            ELSE NULL::"text"
        END AS "opgg_link"
   FROM ("public"."booster_profiles" "bp"
     JOIN "public"."profiles" "p" ON (("p"."id" = "bp"."user_id")))
  WHERE ("bp"."status" = 'approved'::"public"."booster_status");


ALTER VIEW "public"."public_booster_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid",
    "order_id" "uuid" NOT NULL,
    "mp_refund_id" "text",
    "amount" numeric(10,2) NOT NULL,
    "reason" "text" NOT NULL,
    "initiated_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_manual" boolean DEFAULT false NOT NULL,
    CONSTRAINT "refunds_amount_positive" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "booster_id" "uuid",
    "rating" smallint NOT NULL,
    "content" "text",
    "is_public" boolean DEFAULT true NOT NULL,
    "is_moderated" boolean DEFAULT false NOT NULL,
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_content_length" CHECK ((("content" IS NULL) OR ("char_length"("content") <= 2000))),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."riot_league_cutoffs" (
    "queue" "public"."queue_type" NOT NULL,
    "tier" "text" NOT NULL,
    "cutoff_lp" integer NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "riot_league_cutoffs_cutoff_lp_check" CHECK (("cutoff_lp" >= 0)),
    CONSTRAINT "riot_league_cutoffs_tier_check" CHECK (("tier" = ANY (ARRAY['grandmaster'::"text", 'challenger'::"text"])))
);


ALTER TABLE "public"."riot_league_cutoffs" OWNER TO "postgres";


COMMENT ON TABLE "public"."riot_league_cutoffs" IS 'Cache do corte de PDL (menor leaguePoints) das ligas Grão-Mestre/Challenger na Riot, por fila. Escrito só pela edge function riot-league-cutoffs (service role); lido pelo frontend (StepConfigure, detalhes de pedido) e por orderPricing.ts (estimativa de prazo do Master+).';



CREATE TABLE IF NOT EXISTS "public"."service_extras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "price_modifier" numeric(8,2) DEFAULT 0 NOT NULL,
    "price_modifier_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "icon" "text",
    "flow" "text",
    "code" "text",
    "service_type_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "service_extras_flow_check" CHECK ((("flow" IS NULL) OR ("flow" = ANY (ARRAY['solo_standard'::"text", 'duo_standard'::"text", 'master_plus'::"text", 'clash_solo'::"text", 'clash_duo'::"text"])))),
    CONSTRAINT "service_extras_modifiers_nonnegative" CHECK ((("price_modifier" >= (0)::numeric) AND (("price_modifier_pct" >= (0)::numeric) AND ("price_modifier_pct" <= (100)::numeric)))),
    CONSTRAINT "service_extras_service_type_overrides_is_object" CHECK (("jsonb_typeof"("service_type_overrides") = 'object'::"text"))
);


ALTER TABLE "public"."service_extras" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "type" "public"."service_type" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "short_description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."win_price_cents_catalog" (
    "queue_type" "public"."queue_type" NOT NULL,
    "boost_mode" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    CONSTRAINT "win_price_cents_catalog_boost_mode_check" CHECK (("boost_mode" = ANY (ARRAY['solo'::"text", 'duo'::"text"]))),
    CONSTRAINT "win_price_cents_catalog_price_cents_check" CHECK (("price_cents" >= 0))
);


ALTER TABLE "public"."win_price_cents_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."win_price_cents_catalog" IS 'Espelho de WIN_PRICE_CENTS (shared/pricing.ts) -- valor de 1 Vitória Avulsa por fila/modo/tier, em centavos. Usado pelas fórmulas de drop/reatribuição do Mestre+. Sincronizado por shared/winPriceCentsSeed.test.ts.';



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_admin_notes"
    ADD CONSTRAINT "booster_admin_notes_pkey" PRIMARY KEY ("booster_id");



ALTER TABLE ONLY "public"."booster_champion_stats"
    ADD CONSTRAINT "booster_champion_stats_booster_id_account_type_champion_key" UNIQUE ("booster_id", "account_type", "champion");



ALTER TABLE ONLY "public"."booster_champion_stats"
    ADD CONSTRAINT "booster_champion_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_duo_matches"
    ADD CONSTRAINT "booster_duo_matches_order_id_external_match_id_key" UNIQUE ("order_id", "external_match_id");



ALTER TABLE ONLY "public"."booster_duo_matches"
    ADD CONSTRAINT "booster_duo_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_ledger_entries"
    ADD CONSTRAINT "booster_ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_order_events"
    ADD CONSTRAINT "booster_order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_performance_segments"
    ADD CONSTRAINT "booster_performance_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_performance_segments"
    ADD CONSTRAINT "booster_performance_segments_segment_key" UNIQUE ("booster_id", "account_type", "service_type", "rank_bucket", "queue_type");



ALTER TABLE ONLY "public"."booster_profile_events"
    ADD CONSTRAINT "booster_profile_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_profiles"
    ADD CONSTRAINT "booster_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booster_profiles"
    ADD CONSTRAINT "booster_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."booster_services"
    ADD CONSTRAINT "booster_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."duo_account_events"
    ADD CONSTRAINT "duo_account_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."duo_account_reservations"
    ADD CONSTRAINT "duo_account_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."duo_accounts"
    ADD CONSTRAINT "duo_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("scope", "subject");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."master_plus_pricing"
    ADD CONSTRAINT "master_plus_pricing_pair_pdl_mode_key" UNIQUE ("current_tier", "target_tier", "queue_type", "pdl_from", "boost_mode");



ALTER TABLE ONLY "public"."master_plus_pricing"
    ADD CONSTRAINT "master_plus_pricing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_booster_assignments"
    ADD CONSTRAINT "order_booster_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_coaching_topics"
    ADD CONSTRAINT "order_coaching_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_drop_requests"
    ADD CONSTRAINT "order_drop_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_ignored_matches"
    ADD CONSTRAINT "order_ignored_matches_pkey" PRIMARY KEY ("order_id", "external_match_id");



ALTER TABLE ONLY "public"."order_matches"
    ADD CONSTRAINT "order_matches_order_id_external_match_id_key" UNIQUE ("order_id", "external_match_id");



ALTER TABLE ONLY "public"."order_matches"
    ADD CONSTRAINT "order_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_messages"
    ADD CONSTRAINT "order_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_rank_verifications"
    ADD CONSTRAINT "order_rank_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_status_events"
    ADD CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_mp_payment_id_key" UNIQUE ("mp_payment_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_mp_payment_id_key" UNIQUE ("mp_payment_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_webhook_event_id_key" UNIQUE ("webhook_event_id");



ALTER TABLE ONLY "public"."payout_records"
    ADD CONSTRAINT "payout_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_mp_refund_id_key" UNIQUE ("mp_refund_id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."riot_league_cutoffs"
    ADD CONSTRAINT "riot_league_cutoffs_pkey" PRIMARY KEY ("queue", "tier");



ALTER TABLE ONLY "public"."service_extras"
    ADD CONSTRAINT "service_extras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_game_id_type_key" UNIQUE ("game_id", "type");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."win_price_cents_catalog"
    ADD CONSTRAINT "win_price_cents_catalog_pkey" PRIMARY KEY ("queue_type", "boost_mode", "tier");



CREATE INDEX "audit_logs_actor_idx" ON "public"."audit_logs" USING "btree" ("actor_id");



CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "audit_logs_entity_idx" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "booster_champion_stats_lookup_idx" ON "public"."booster_champion_stats" USING "btree" ("booster_id", "account_type", "games_played" DESC);



CREATE INDEX "booster_duo_matches_booster_idx" ON "public"."booster_duo_matches" USING "btree" ("booster_id", "played_at" DESC);



CREATE INDEX "booster_duo_matches_order_idx" ON "public"."booster_duo_matches" USING "btree" ("order_id", "played_at" DESC);



CREATE INDEX "booster_ledger_entries_booster_idx" ON "public"."booster_ledger_entries" USING "btree" ("booster_id", "created_at" DESC);



CREATE INDEX "booster_ledger_entries_order_idx" ON "public"."booster_ledger_entries" USING "btree" ("order_id") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "booster_ledger_entries_payout_request_idx" ON "public"."booster_ledger_entries" USING "btree" ("payout_request_id") WHERE ("payout_request_id" IS NOT NULL);



CREATE INDEX "booster_performance_segments_booster_idx" ON "public"."booster_performance_segments" USING "btree" ("booster_id");



CREATE INDEX "booster_performance_segments_lookup_idx" ON "public"."booster_performance_segments" USING "btree" ("service_type", "rank_bucket", "performance_score" DESC);



CREATE UNIQUE INDEX "booster_profiles_display_name_lower_key" ON "public"."booster_profiles" USING "btree" ("lower"("display_name"));



CREATE INDEX "booster_profiles_status_idx" ON "public"."booster_profiles" USING "btree" ("status");



CREATE INDEX "booster_profiles_top5_idx" ON "public"."booster_profiles" USING "btree" ("is_top3") WHERE ("is_top3" = true);



CREATE INDEX "booster_services_active_idx" ON "public"."booster_services" USING "btree" ("is_active");



CREATE INDEX "booster_services_booster_idx" ON "public"."booster_services" USING "btree" ("booster_id");



CREATE INDEX "booster_services_not_deleted_idx" ON "public"."booster_services" USING "btree" ("booster_id", "created_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "duo_account_reservations_account_idx" ON "public"."duo_account_reservations" USING "btree" ("account_id", "reserved_at" DESC);



CREATE UNIQUE INDEX "duo_account_reservations_one_open_idx" ON "public"."duo_account_reservations" USING "btree" ("account_id") WHERE ("released_at" IS NULL);



CREATE INDEX "duo_accounts_active_idx" ON "public"."duo_accounts" USING "btree" ("is_active");



CREATE INDEX "duo_accounts_created_by_idx" ON "public"."duo_accounts" USING "btree" ("created_by");



CREATE INDEX "duo_accounts_reserved_by_idx" ON "public"."duo_accounts" USING "btree" ("reserved_by") WHERE ("reserved_by" IS NOT NULL);



CREATE UNIQUE INDEX "duo_accounts_reserved_order_uidx" ON "public"."duo_accounts" USING "btree" ("reserved_order_id") WHERE ("reserved_order_id" IS NOT NULL);



CREATE INDEX "idx_orders_pending_awaiting_assignment_announce" ON "public"."orders" USING "btree" ("updated_at") WHERE (("status" = 'awaiting_assignment'::"public"."order_status") AND ("awaiting_assignment_announced_at" IS NULL));



CREATE INDEX "idx_orders_pending_exclusive_expiry" ON "public"."orders" USING "btree" ("exclusive_until") WHERE (("status" = 'awaiting_assignment'::"public"."order_status") AND ("preferred_booster_id" IS NOT NULL) AND ("exclusive_expired_announced_at" IS NULL));



CREATE INDEX "master_plus_pricing_updated_by_idx" ON "public"."master_plus_pricing" USING "btree" ("updated_by");



CREATE INDEX "notifications_unread_idx" ON "public"."notifications" USING "btree" ("user_id", "is_read") WHERE ("is_read" = false);



CREATE INDEX "notifications_user_idx" ON "public"."notifications" USING "btree" ("user_id");



CREATE UNIQUE INDEX "order_booster_assignments_open_idx" ON "public"."order_booster_assignments" USING "btree" ("order_id") WHERE ("unassigned_at" IS NULL);



CREATE INDEX "order_booster_assignments_order_idx" ON "public"."order_booster_assignments" USING "btree" ("order_id", "assigned_at" DESC);



CREATE INDEX "order_coaching_topics_order_idx" ON "public"."order_coaching_topics" USING "btree" ("order_id", "created_at");



CREATE INDEX "order_drop_requests_admin_id_idx" ON "public"."order_drop_requests" USING "btree" ("admin_id");



CREATE INDEX "order_drop_requests_booster_id_idx" ON "public"."order_drop_requests" USING "btree" ("booster_id");



CREATE UNIQUE INDEX "order_drop_requests_one_pending_idx" ON "public"."order_drop_requests" USING "btree" ("order_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "order_matches_booster_idx" ON "public"."order_matches" USING "btree" ("booster_id", "played_at" DESC);



CREATE INDEX "order_matches_order_idx" ON "public"."order_matches" USING "btree" ("order_id", "played_at" DESC);



CREATE INDEX "order_messages_order_idx" ON "public"."order_messages" USING "btree" ("order_id");



CREATE INDEX "order_messages_sender_idx" ON "public"."order_messages" USING "btree" ("sender_id");



CREATE INDEX "order_rank_verifications_order_idx" ON "public"."order_rank_verifications" USING "btree" ("order_id");



CREATE INDEX "order_rank_verifications_requested_by_idx" ON "public"."order_rank_verifications" USING "btree" ("requested_by");



CREATE INDEX "order_status_events_order_idx" ON "public"."order_status_events" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "order_status_history_changed_by_idx" ON "public"."order_status_history" USING "btree" ("changed_by");



CREATE INDEX "order_status_history_order_idx" ON "public"."order_status_history" USING "btree" ("order_id");



CREATE INDEX "orders_booster_completed_at_idx" ON "public"."orders" USING "btree" ("assigned_booster_id", "completed_at") WHERE ("status" = 'completed'::"public"."order_status");



CREATE INDEX "orders_booster_id_idx" ON "public"."orders" USING "btree" ("assigned_booster_id");



CREATE INDEX "orders_booster_service_id_idx" ON "public"."orders" USING "btree" ("booster_service_id");



CREATE INDEX "orders_chat_locked_by_idx" ON "public"."orders" USING "btree" ("chat_locked_by");



CREATE INDEX "orders_created_at_idx" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "orders_customer_id_idx" ON "public"."orders" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "orders_customer_idempotency_idx" ON "public"."orders" USING "btree" ("customer_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "orders_pending_review_release_idx" ON "public"."orders" USING "btree" ("review_release_at") WHERE (("status" = 'pending_review'::"public"."order_status") AND ("admin_review_locked" = false));



CREATE INDEX "orders_preferred_booster_idx" ON "public"."orders" USING "btree" ("preferred_booster_id") WHERE ("preferred_booster_id" IS NOT NULL);



CREATE INDEX "orders_service_type_idx" ON "public"."orders" USING "btree" ("service_type");



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "payments_customer_idx" ON "public"."payments" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "payments_order_unique_idx" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "payments_status_idx" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "payout_records_booster_idx" ON "public"."payout_records" USING "btree" ("booster_id");



CREATE UNIQUE INDEX "payout_records_order_unique_idx" ON "public"."payout_records" USING "btree" ("order_id");



CREATE INDEX "payout_records_status_idx" ON "public"."payout_records" USING "btree" ("status");



CREATE INDEX "payout_requests_booster_idx" ON "public"."payout_requests" USING "btree" ("booster_id");



CREATE INDEX "payout_requests_status_idx" ON "public"."payout_requests" USING "btree" ("status");



CREATE INDEX "profiles_role_idx" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "refunds_initiated_by_idx" ON "public"."refunds" USING "btree" ("initiated_by");



CREATE INDEX "refunds_order_id_idx" ON "public"."refunds" USING "btree" ("order_id");



CREATE INDEX "refunds_payment_id_idx" ON "public"."refunds" USING "btree" ("payment_id");



CREATE INDEX "reviews_booster_idx" ON "public"."reviews" USING "btree" ("booster_id");



CREATE INDEX "reviews_customer_id_idx" ON "public"."reviews" USING "btree" ("customer_id");



CREATE INDEX "reviews_public_idx" ON "public"."reviews" USING "btree" ("is_public") WHERE ("is_public" = true);



CREATE UNIQUE INDEX "service_extras_flow_code_idx" ON "public"."service_extras" USING "btree" ("flow", "code") WHERE (("flow" IS NOT NULL) AND ("code" IS NOT NULL));



CREATE INDEX "service_extras_service_id_idx" ON "public"."service_extras" USING "btree" ("service_id");



CREATE OR REPLACE TRIGGER "booster_profiles_lock_privileged_columns" BEFORE UPDATE ON "public"."booster_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"();



CREATE OR REPLACE TRIGGER "booster_profiles_lock_status" BEFORE UPDATE ON "public"."booster_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_non_admin_booster_status_change"();



CREATE OR REPLACE TRIGGER "clear_terminal_order_credentials_trigger" BEFORE UPDATE OF "status", "payment_status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."clear_terminal_order_credentials"();



CREATE OR REPLACE TRIGGER "release_paid_order_after_credentials" AFTER UPDATE OF "credentials_set" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."release_paid_order_after_credentials"();



CREATE OR REPLACE TRIGGER "reviews_refresh_booster_rating" AFTER INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"();



CREATE OR REPLACE TRIGGER "set_booster_services_updated_at" BEFORE UPDATE ON "public"."booster_services" FOR EACH ROW EXECUTE FUNCTION "public"."update_booster_services_updated_at"();



CREATE OR REPLACE TRIGGER "set_duo_accounts_updated_at" BEFORE UPDATE ON "public"."duo_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_duo_accounts_updated_at"();



CREATE OR REPLACE TRIGGER "set_master_plus_pricing_updated_at" BEFORE UPDATE ON "public"."master_plus_pricing" FOR EACH ROW EXECUTE FUNCTION "public"."set_master_plus_pricing_updated_at"();



CREATE OR REPLACE TRIGGER "trg_booster_active_on_accept" AFTER UPDATE OF "assigned_booster_id" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_booster_active_on_accept"();



CREATE OR REPLACE TRIGGER "trg_booster_active_on_message" AFTER INSERT ON "public"."order_messages" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_booster_active_on_message"();



CREATE OR REPLACE TRIGGER "trg_cap_active_clash_orders" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_cap_active_clash_orders"();



CREATE OR REPLACE TRIGGER "trg_cap_coach_packages" BEFORE INSERT ON "public"."booster_services" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_cap_coach_packages"();



CREATE OR REPLACE TRIGGER "trg_cap_pending_orders" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_cap_pending_orders"();



CREATE OR REPLACE TRIGGER "trg_enforce_booster_display_name_cooldown" BEFORE UPDATE OF "display_name" ON "public"."booster_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"();



CREATE OR REPLACE TRIGGER "trg_guard_booster_profile_trust_columns" BEFORE UPDATE ON "public"."booster_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"();



CREATE OR REPLACE TRIGGER "trg_guard_customer_profile_trust_columns" BEFORE UPDATE ON "public"."customer_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"();



CREATE OR REPLACE TRIGGER "trg_guard_notifications_user_update" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_guard_notifications_user_update"();



CREATE OR REPLACE TRIGGER "trg_guard_profiles_trust_columns" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_guard_profiles_trust_columns"();



CREATE OR REPLACE TRIGGER "trg_lock_chat_on_order_completed" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_lock_chat_on_order_completed"();



CREATE OR REPLACE TRIGGER "trg_notify_admins_on_pending_review" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."notify_admins_on_pending_review"();



CREATE OR REPLACE TRIGGER "trg_notify_booster_profile_changed" AFTER UPDATE OF "status", "rating", "rating_count", "is_top3", "current_rank", "display_name", "last_active_at", "suspended_until" ON "public"."booster_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."notify_booster_profile_changed"();



CREATE OR REPLACE TRIGGER "trg_notify_boosters_order_available" AFTER INSERT OR UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."notify_boosters_order_available"();



CREATE OR REPLACE TRIGGER "trg_notify_discord_chat_mention" AFTER INSERT ON "public"."notifications" FOR EACH ROW WHEN (("new"."type" = 'chat_mention'::"text")) EXECUTE FUNCTION "public"."notify_discord_chat_mention"();



CREATE OR REPLACE TRIGGER "trg_notify_discord_order_webhook" AFTER INSERT OR UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."notify_discord_order_webhook"();



CREATE OR REPLACE TRIGGER "trg_notify_discord_review" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."notify_discord_review"();



CREATE OR REPLACE TRIGGER "trg_notify_duo_account_changed" AFTER INSERT OR DELETE OR UPDATE ON "public"."duo_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."notify_duo_account_changed"();



CREATE OR REPLACE TRIGGER "trg_notify_order_status_changed" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."notify_order_status_changed"();



CREATE OR REPLACE TRIGGER "trg_order_completed_booster_stats" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_order_completed_booster_stats"();



CREATE OR REPLACE TRIGGER "trg_order_messages_rate_limit" BEFORE INSERT ON "public"."order_messages" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_enforce_message_rate_limit"();



CREATE OR REPLACE TRIGGER "trg_order_paid_customer_stats" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_order_paid_customer_stats"();



CREATE OR REPLACE TRIGGER "trg_refunds_dedupe_provider_after_manual" BEFORE INSERT ON "public"."refunds" FOR EACH ROW EXECUTE FUNCTION "public"."dedupe_provider_refund_after_manual"();



CREATE OR REPLACE TRIGGER "trg_release_duo_account_on_order_end" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_release_duo_account_on_order_end"();



CREATE OR REPLACE TRIGGER "trg_reviews_rate_limit" BEFORE INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_enforce_review_rate_limit"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."booster_admin_notes"
    ADD CONSTRAINT "booster_admin_notes_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_admin_notes"
    ADD CONSTRAINT "booster_admin_notes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."booster_champion_stats"
    ADD CONSTRAINT "booster_champion_stats_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_duo_matches"
    ADD CONSTRAINT "booster_duo_matches_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_duo_matches"
    ADD CONSTRAINT "booster_duo_matches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_ledger_entries"
    ADD CONSTRAINT "booster_ledger_entries_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."booster_ledger_entries"
    ADD CONSTRAINT "booster_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."booster_ledger_entries"
    ADD CONSTRAINT "booster_ledger_entries_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "public"."payout_requests"("id");



ALTER TABLE ONLY "public"."booster_order_events"
    ADD CONSTRAINT "booster_order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_performance_segments"
    ADD CONSTRAINT "booster_performance_segments_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_profiles"
    ADD CONSTRAINT "booster_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booster_services"
    ADD CONSTRAINT "booster_services_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."duo_account_reservations"
    ADD CONSTRAINT "duo_account_reservations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."duo_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."duo_account_reservations"
    ADD CONSTRAINT "duo_account_reservations_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."duo_account_reservations"
    ADD CONSTRAINT "duo_account_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."duo_account_reservations"
    ADD CONSTRAINT "duo_account_reservations_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."duo_accounts"
    ADD CONSTRAINT "duo_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."duo_accounts"
    ADD CONSTRAINT "duo_accounts_last_released_by_fkey" FOREIGN KEY ("last_released_by") REFERENCES "public"."booster_profiles"("user_id");



ALTER TABLE ONLY "public"."duo_accounts"
    ADD CONSTRAINT "duo_accounts_reserved_by_fkey" FOREIGN KEY ("reserved_by") REFERENCES "public"."booster_profiles"("user_id");



ALTER TABLE ONLY "public"."duo_accounts"
    ADD CONSTRAINT "duo_accounts_reserved_order_id_fkey" FOREIGN KEY ("reserved_order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_booster_assignments"
    ADD CONSTRAINT "order_booster_assignments_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id");



ALTER TABLE ONLY "public"."order_booster_assignments"
    ADD CONSTRAINT "order_booster_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_coaching_topics"
    ADD CONSTRAINT "order_coaching_topics_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_coaching_topics"
    ADD CONSTRAINT "order_coaching_topics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_coaching_topics"
    ADD CONSTRAINT "order_coaching_topics_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_drop_requests"
    ADD CONSTRAINT "order_drop_requests_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_drop_requests"
    ADD CONSTRAINT "order_drop_requests_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_drop_requests"
    ADD CONSTRAINT "order_drop_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_ignored_matches"
    ADD CONSTRAINT "order_ignored_matches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_matches"
    ADD CONSTRAINT "order_matches_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."booster_profiles"("user_id");



ALTER TABLE ONLY "public"."order_matches"
    ADD CONSTRAINT "order_matches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_messages"
    ADD CONSTRAINT "order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_messages"
    ADD CONSTRAINT "order_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_rank_verifications"
    ADD CONSTRAINT "order_rank_verifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."order_rank_verifications"
    ADD CONSTRAINT "order_rank_verifications_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_status_events"
    ADD CONSTRAINT "order_status_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_status_history"
    ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_assigned_booster_id_fkey" FOREIGN KEY ("assigned_booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_booster_service_id_fkey" FOREIGN KEY ("booster_service_id") REFERENCES "public"."booster_services"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_chat_locked_by_fkey" FOREIGN KEY ("chat_locked_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_preferred_booster_id_fkey" FOREIGN KEY ("preferred_booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."payout_records"
    ADD CONSTRAINT "payout_records_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payout_records"
    ADD CONSTRAINT "payout_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."service_extras"
    ADD CONSTRAINT "service_extras_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id");



CREATE POLICY "admins_update_drop_requests" ON "public"."order_drop_requests" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "approved_boosters_read_order_events" ON "public"."booster_order_events" FOR SELECT USING ("public"."is_approved_booster"());



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_admin_read" ON "public"."audit_logs" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "audit_logs_insert" ON "public"."audit_logs" FOR INSERT WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."booster_admin_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_admin_notes_admin_only" ON "public"."booster_admin_notes" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."booster_champion_stats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_champion_stats_read" ON "public"."booster_champion_stats" FOR SELECT USING (true);



ALTER TABLE "public"."booster_duo_matches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_duo_matches_read" ON "public"."booster_duo_matches" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "booster_duo_matches"."order_id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"())))))));



ALTER TABLE "public"."booster_ledger_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_ledger_entries_read" ON "public"."booster_ledger_entries" FOR SELECT USING ((("booster_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."booster_order_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booster_performance_segments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_performance_segments_read" ON "public"."booster_performance_segments" FOR SELECT USING (true);



ALTER TABLE "public"."booster_profile_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_profile_events_read" ON "public"."booster_profile_events" FOR SELECT USING ((("booster_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."booster_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_profiles_read_own_or_admin" ON "public"."booster_profiles" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "booster_profiles_update_own_or_admin" ON "public"."booster_profiles" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."booster_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booster_services_owner_delete" ON "public"."booster_services" FOR DELETE USING (("booster_id" = "auth"."uid"()));



CREATE POLICY "booster_services_owner_insert" ON "public"."booster_services" FOR INSERT WITH CHECK (("booster_id" = "auth"."uid"()));



CREATE POLICY "booster_services_owner_update" ON "public"."booster_services" FOR UPDATE USING (("booster_id" = "auth"."uid"())) WITH CHECK (("booster_id" = "auth"."uid"()));



CREATE POLICY "booster_services_read" ON "public"."booster_services" FOR SELECT USING ((("booster_id" = "auth"."uid"()) OR ("is_active" AND "public"."is_approved_booster"("booster_id")) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."booster_service_id" = "booster_services"."id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"())))))));



CREATE POLICY "boosters_select_own_drop_requests" ON "public"."order_drop_requests" FOR SELECT USING ((("booster_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_profiles_insert_own" ON "public"."customer_profiles" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("total_orders" = 0) AND ("total_spent" = (0)::numeric)));



CREATE POLICY "customer_profiles_read_own" ON "public"."customer_profiles" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "customer_profiles_update_own" ON "public"."customer_profiles" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."duo_account_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "duo_account_events_read" ON "public"."duo_account_events" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."duo_accounts" "da"
  WHERE (("da"."id" = "duo_account_events"."account_id") AND ("da"."reserved_by" = "auth"."uid"()))))));



ALTER TABLE "public"."duo_account_reservations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "duo_account_reservations_admin_read" ON "public"."duo_account_reservations" FOR SELECT USING ("public"."is_admin"());



ALTER TABLE "public"."duo_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "duo_accounts_admin_delete" ON "public"."duo_accounts" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "duo_accounts_admin_insert" ON "public"."duo_accounts" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "duo_accounts_admin_update" ON "public"."duo_accounts" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "duo_accounts_read" ON "public"."duo_accounts" FOR SELECT USING (("public"."is_admin"() OR ("is_active" AND (("reserved_by" IS NULL) OR ("reserved_by" = "auth"."uid"())) AND (EXISTS ( SELECT 1
   FROM "public"."booster_profiles" "bp"
  WHERE (("bp"."user_id" = "auth"."uid"()) AND ("bp"."status" = 'approved'::"public"."booster_status")))))));



ALTER TABLE "public"."edge_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "games_admin_delete" ON "public"."games" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "games_admin_insert" ON "public"."games" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "games_admin_read" ON "public"."games" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "games_admin_update" ON "public"."games" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "games_public_read" ON "public"."games" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



ALTER TABLE "public"."master_plus_pricing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_plus_pricing_admin_delete" ON "public"."master_plus_pricing" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "master_plus_pricing_admin_insert" ON "public"."master_plus_pricing" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "master_plus_pricing_admin_read" ON "public"."master_plus_pricing" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "master_plus_pricing_admin_update" ON "public"."master_plus_pricing" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "master_plus_pricing_read" ON "public"."master_plus_pricing" FOR SELECT TO "authenticated", "anon" USING (("price" IS NOT NULL));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_read_own" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_own" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."order_booster_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_coaching_topics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_coaching_topics_read" ON "public"."order_coaching_topics" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_coaching_topics"."order_id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"())))))));



ALTER TABLE "public"."order_drop_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_ignored_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_matches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_matches_read" ON "public"."order_matches" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_matches"."order_id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"())))))));



ALTER TABLE "public"."order_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_messages_read" ON "public"."order_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_messages"."order_id") AND ("o"."assigned_booster_id" IS NOT NULL) AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"()) OR "public"."is_admin"())))));



ALTER TABLE "public"."order_rank_verifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_rank_verifications_read" ON "public"."order_rank_verifications" FOR SELECT USING ((("requested_by" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_rank_verifications"."order_id") AND ("o"."customer_id" = "auth"."uid"()))))));



ALTER TABLE "public"."order_status_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_status_events_read" ON "public"."order_status_events" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_status_events"."order_id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"())))))));



ALTER TABLE "public"."order_status_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_status_history_insert" ON "public"."order_status_history" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "order_status_history_read" ON "public"."order_status_history" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_status_history"."order_id") AND (("o"."customer_id" = "auth"."uid"()) OR ("o"."assigned_booster_id" = "auth"."uid"()))))) OR "public"."is_admin"()));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_customer_read" ON "public"."orders" FOR SELECT USING ((("customer_id" = "auth"."uid"()) OR ("assigned_booster_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "orders_update" ON "public"."orders" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_admin_delete" ON "public"."payments" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "payments_admin_insert" ON "public"."payments" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "payments_admin_update" ON "public"."payments" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "payments_read" ON "public"."payments" FOR SELECT USING ((("customer_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."payout_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payout_records_admin_update" ON "public"."payout_records" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "payout_records_read" ON "public"."payout_records" FOR SELECT USING ((("booster_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."payout_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payout_requests_read" ON "public"."payout_requests" FOR SELECT USING ((("booster_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_read_own" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ("role" = ( SELECT "profiles_1"."role"
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."id" = "auth"."uid"())))));



ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "refunds_read" ON "public"."refunds" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."payments" "p"
  WHERE (("p"."id" = "refunds"."payment_id") AND ("p"."customer_id" = "auth"."uid"())))) OR "public"."is_admin"()));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_customer_insert" ON "public"."reviews" FOR INSERT WITH CHECK ((("customer_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "reviews"."order_id") AND ("o"."customer_id" = "auth"."uid"()) AND ("o"."status" = 'completed'::"public"."order_status") AND (NOT ("o"."assigned_booster_id" IS DISTINCT FROM "reviews"."booster_id")))))));



CREATE POLICY "reviews_public_read" ON "public"."reviews" FOR SELECT USING ((("is_public" = true) OR ("customer_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."riot_league_cutoffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "riot_league_cutoffs_read" ON "public"."riot_league_cutoffs" FOR SELECT USING (true);



ALTER TABLE "public"."service_extras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_extras_admin_delete" ON "public"."service_extras" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "service_extras_admin_insert" ON "public"."service_extras" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "service_extras_admin_read" ON "public"."service_extras" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "service_extras_admin_update" ON "public"."service_extras" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "service_extras_public_read" ON "public"."service_extras" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_admin_delete" ON "public"."services" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "services_admin_insert" ON "public"."services" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "services_admin_read" ON "public"."services" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "services_admin_update" ON "public"."services" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "services_public_read" ON "public"."services" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



ALTER TABLE "public"."win_price_cents_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "win_price_cents_catalog_read" ON "public"."win_price_cents_catalog" FOR SELECT USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."booster_order_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."booster_profile_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."duo_account_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_coaching_topics";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_drop_requests";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_status_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payout_requests";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."refunds";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































































































































REVOKE ALL ON FUNCTION "public"."_release_pending_review_order"("p_order_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_release_pending_review_order"("p_order_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_boost_order"("p_order_id" "uuid", "p_booster_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_boost_order"("p_order_id" "uuid", "p_booster_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_boost_order"("p_order_id" "uuid", "p_booster_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_order_coaching_topic"("p_order_id" "uuid", "p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_order_coaching_topic"("p_order_id" "uuid", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_order_coaching_topic"("p_order_id" "uuid", "p_content" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_adjust_booster_balance"("p_booster_id" "uuid", "p_amount" numeric, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_adjust_booster_balance"("p_booster_id" "uuid", "p_amount" numeric, "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_adjust_booster_balance"("p_booster_id" "uuid", "p_amount" numeric, "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_assign_pending_review_order"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_cancel_manual_refund"("p_refund_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_manual_refund"("p_refund_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_manual_refund"("p_refund_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_pending_review_order"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_pending_review_order"("p_order_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_cancel_pending_review_order"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_confirm_manual_refund"("p_refund_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_confirm_manual_refund"("p_refund_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_confirm_manual_refund"("p_refund_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_manual_refund"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_manual_refund"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_create_manual_refund"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_dashboard_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_dashboard_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_drop_order"("p_order_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_drop_order"("p_order_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_drop_order"("p_order_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_flag_order_under_review"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_flag_order_under_review"("p_order_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_flag_order_under_review"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_list_boosters_with_slots"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_boosters_with_slots"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_list_boosters_with_slots"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_list_pending_review_states"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_pending_review_states"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_list_pending_review_states"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_list_review_cases"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_review_cases"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_review_cases"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_proof_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_proof_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_proof_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_override_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_override_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_override_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reassign_booster"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reassign_booster"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_reassign_booster"("p_order_id" "uuid", "p_target_booster_id" "uuid", "p_reason" "text", "p_coaching_completion_pct" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_release_duo_account"("p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_release_duo_account"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_release_duo_account"("p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_review_payout_request"("p_request_id" "uuid", "p_new_status" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_review_payout_request"("p_request_id" "uuid", "p_new_status" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_payout_request"("p_request_id" "uuid", "p_new_status" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_order_chat_lock"("p_order_id" "uuid", "p_locked" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_order_chat_lock"("p_order_id" "uuid", "p_locked" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_order_chat_lock"("p_order_id" "uuid", "p_locked" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_set_pending_review_lock"("p_order_id" "uuid", "p_locked" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_order_drop"("p_order_id" "uuid", "p_from_status" "text", "p_actor_id" "uuid", "p_reason" "text", "p_requester_role" "public"."drop_requester_role", "p_coaching_completion_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_order_drop"("p_order_id" "uuid", "p_from_status" "text", "p_actor_id" "uuid", "p_reason" "text", "p_requester_role" "public"."drop_requester_role", "p_coaching_completion_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_booster"("p_booster_id" "uuid", "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_booster"("p_booster_id" "uuid", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_booster"("p_booster_id" "uuid", "p_new_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_active_slot_counts"("p_booster_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_active_slot_counts"("p_booster_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_active_slot_counts"("p_booster_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_assigned_at"("p_order_id" "uuid", "p_played_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_assigned_at"("p_order_id" "uuid", "p_played_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_available_balance"("p_booster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_available_balance"("p_booster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_available_balance"("p_booster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_display_name_cooldown_days_remaining"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_display_name_cooldown_days_remaining"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_display_name_cooldown_days_remaining"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_has_active_exclusive_slot"("p_booster_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_has_active_exclusive_slot"("p_booster_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_has_active_exclusive_slot"("p_booster_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_heartbeat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_heartbeat"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_heartbeat"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."booster_payout_totals"("p_booster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booster_payout_totals"("p_booster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booster_payout_totals"("p_booster_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_booster_accept_order"("p_booster_user_id" "uuid", "p_boost_mode" "text", "p_service_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_booster_accept_order"("p_booster_user_id" "uuid", "p_boost_mode" "text", "p_service_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_booster_accept_order"("p_booster_user_id" "uuid", "p_boost_mode" "text", "p_service_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_payout_request"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_payout_request"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_payout_request"("p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_pending_order_payment"("p_order_id" "uuid", "p_customer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_pending_order_payment"("p_order_id" "uuid", "p_customer_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_own_write_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_own_write_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_own_write_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."clear_duo_own_riot_id"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_duo_own_riot_id"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_duo_own_riot_id"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_terminal_order_credentials"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_terminal_order_credentials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_terminal_order_credentials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_verified_order"("p_order_id" "uuid", "p_fetched_tier" "text", "p_fetched_division" "text", "p_requested_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_verified_order"("p_order_id" "uuid", "p_fetched_tier" "text", "p_fetched_division" "text", "p_requested_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_drop_penalty"("p_requester_role" "public"."drop_requester_role", "p_full_value" numeric, "p_share_value" numeric, "p_losses_played" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_drop_penalty"("p_requester_role" "public"."drop_requester_role", "p_full_value" numeric, "p_share_value" numeric, "p_losses_played" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_drop_penalty"("p_requester_role" "public"."drop_requester_role", "p_full_value" numeric, "p_share_value" numeric, "p_losses_played" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_order_completion"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_order_completion"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_order_completion"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";



REVOKE ALL ON FUNCTION "public"."dedupe_provider_refund_after_manual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dedupe_provider_refund_after_manual"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_duo_account"("p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_duo_account"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_duo_account"("p_account_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."duo_account_rank_is_valid"("p_rank" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."duo_account_rank_is_valid"("p_rank" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."duo_account_rank_is_valid"("p_rank" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_profile_exists"("p_display_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_display_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_display_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expel_booster"("p_booster_id" "uuid", "p_reason" "text", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expel_booster"("p_booster_id" "uuid", "p_reason" "text", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_booster_suspensions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_booster_suspensions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_pix_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_pix_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_customer_order_state"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_customer_order_state"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_order_state"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_duo_account_access_token"("p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_duo_account_access_token"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_duo_account_access_token"("p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_duo_account_credentials"("p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_duo_account_credentials"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_duo_account_credentials"("p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_duo_account_reservation_history"("p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_duo_account_reservation_history"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_duo_account_reservation_history"("p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_chat"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_chat"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_chat"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_chat_mention_targets"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_chat_mention_targets"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_chat_mention_targets"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_credentials"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_credentials"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_credentials"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_customer_nickname"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_customer_nickname"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_customer_nickname"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_duo_account_history"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_duo_account_history"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_duo_account_history"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_duo_partner_riot_id"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_duo_partner_riot_id"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_duo_partner_riot_id"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booster_reviews"("p_booster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_top_boosters"("p_service_type" "text", "p_rank_bucket" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_top_boosters"("p_service_type" "text", "p_rank_bucket" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_boosters"("p_service_type" "text", "p_rank_bucket" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_boosters"("p_service_type" "text", "p_rank_bucket" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_approved_booster"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_approved_booster"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_approved_booster"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_approved_booster"("p_booster_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_approved_booster"("p_booster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_approved_booster"("p_booster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_customer_inactivity_reminder_targets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_customer_inactivity_reminder_targets"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_duo_accounts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_duo_accounts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_duo_accounts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_payout_reminder_targets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_payout_reminder_targets"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_customer_inactivity_reminder_sent"("p_customer_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_customer_inactivity_reminder_sent"("p_customer_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_order_chat_read"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_order_chat_read"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_order_chat_read"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_order_match_sync"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_order_match_sync"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_admins_on_canceled_order_payment_approval"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_admins_on_canceled_order_payment_approval"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_admins_on_pending_review"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_admins_on_pending_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_booster_profile_changed"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_booster_profile_changed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_booster_profile_changed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_boosters_order_available"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_boosters_order_available"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_discord_chat_mention"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_discord_chat_mention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_discord_chat_mention"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_discord_order_webhook"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_discord_order_webhook"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_discord_order_webhook"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_discord_review"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_discord_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_discord_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_duo_account_changed"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_duo_account_changed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_duo_account_changed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_order_status_changed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_order_status_changed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text", "p_hours_per_day_min" integer, "p_hours_per_day_max" integer, "p_full_name" "text", "p_cpf" "text", "p_available_days" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."onboard_booster"("p_display_name" "text", "p_bio" "text", "p_peak_rank" "jsonb", "p_opgg_link" "text", "p_hours_per_day_min" integer, "p_hours_per_day_max" integer, "p_full_name" "text", "p_cpf" "text", "p_available_days" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_drop_completion_pct"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."order_requires_access_token"("p_service_type" "public"."service_type", "p_boost_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."order_requires_access_token"("p_service_type" "public"."service_type", "p_boost_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_requires_access_token"("p_service_type" "public"."service_type", "p_boost_mode" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."payout_request_order_breakdown"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."payout_request_order_breakdown"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payout_request_order_breakdown"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_non_admin_booster_privileged_column_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_non_admin_booster_status_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_non_admin_booster_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_non_admin_booster_status_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_mp_payment_event"("p_order_id" "uuid", "p_mp_payment_id" "text", "p_provider_status" "text", "p_amount" numeric, "p_currency" "text", "p_event_id" "text", "p_refund_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_mp_payment_event"("p_order_id" "uuid", "p_mp_payment_id" "text", "p_provider_status" "text", "p_amount" numeric, "p_currency" "text", "p_event_id" "text", "p_refund_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rank_bucket_of"("p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rank_bucket_of"("p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rank_bucket_of"("p_tier" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rank_step"("p_tier" "text", "p_division" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rank_step"("p_tier" "text", "p_division" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rank_step"("p_tier" "text", "p_division" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_card_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_card_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_duo_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_duo_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_order_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer, "p_duo_participated" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_order_match"("p_order_id" "uuid", "p_external_match_id" "text", "p_result" "text", "p_champion" "text", "p_kills" integer, "p_deaths" integer, "p_assists" integer, "p_queue_id" integer, "p_duration_seconds" integer, "p_played_at" timestamp with time zone, "p_minions_killed" integer, "p_neutral_minions_killed" integer, "p_is_mvp" boolean, "p_vision_score" integer, "p_duo_participated" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_pix_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_pix_payment"("p_order_id" "uuid", "p_customer_id" "uuid", "p_mp_payment_id" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_booster_performance_segments"("p_booster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_booster_performance_segments"("p_booster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_booster_rating"("p_booster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_booster_rating"("p_booster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_top3_boosters"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_top3_boosters"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_duo_account_reservation"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_duo_account_reservation"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_duo_account_reservation"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_paid_order_after_credentials"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_paid_order_after_credentials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_pending_review_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_pending_review_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_booster_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_booster_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_booster_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_customer_order_drop"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_customer_order_drop"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_customer_order_drop"("p_order_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_order_drop"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_order_drop"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_order_drop"("p_order_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_payout"("p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_payout"("p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_payout"("p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_duo_account"("p_order_id" "uuid", "p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_duo_account"("p_order_id" "uuid", "p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_duo_account"("p_order_id" "uuid", "p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_drop_request"("p_request_id" "uuid", "p_approve" boolean, "p_admin_note" "text", "p_coaching_completion_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_drop_request"("p_request_id" "uuid", "p_approve" boolean, "p_admin_note" "text", "p_coaching_completion_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_drop_request"("p_request_id" "uuid", "p_approve" boolean, "p_admin_note" "text", "p_coaching_completion_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_duo_account_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_duo_account_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_order_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_order_access_token"("p_access_token" "text", "p_booster_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_duo_account"("p_label" "text", "p_tier" "text", "p_division" "text", "p_is_active" boolean, "p_account_id" "uuid", "p_notes" "text", "p_login" "text", "p_password" "text", "p_riot_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_duo_account"("p_label" "text", "p_tier" "text", "p_division" "text", "p_is_active" boolean, "p_account_id" "uuid", "p_notes" "text", "p_login" "text", "p_password" "text", "p_riot_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_duo_account"("p_label" "text", "p_tier" "text", "p_division" "text", "p_is_active" boolean, "p_account_id" "uuid", "p_notes" "text", "p_login" "text", "p_password" "text", "p_riot_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_order_message"("p_order_id" "uuid", "p_content" "text", "p_mentioned_user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_order_message"("p_order_id" "uuid", "p_content" "text", "p_mentioned_user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_order_message"("p_order_id" "uuid", "p_content" "text", "p_mentioned_user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_booster_admin_note"("p_booster_id" "uuid", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_booster_admin_note"("p_booster_id" "uuid", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_booster_admin_note"("p_booster_id" "uuid", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_duo_account_active"("p_account_id" "uuid", "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_duo_account_active"("p_account_id" "uuid", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_duo_account_active"("p_account_id" "uuid", "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_duo_own_riot_id"("p_order_id" "uuid", "p_riot_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_duo_own_riot_id"("p_order_id" "uuid", "p_riot_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_duo_own_riot_id"("p_order_id" "uuid", "p_riot_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_master_plus_pricing_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_master_plus_pricing_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_master_plus_pricing_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_order_coaching_topic_done"("p_order_id" "uuid", "p_topic_id" "uuid", "p_done" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_order_coaching_topic_done"("p_order_id" "uuid", "p_topic_id" "uuid", "p_done" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_order_coaching_topic_done"("p_order_id" "uuid", "p_topic_id" "uuid", "p_done" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_order_credentials"("p_order_id" "uuid", "p_login" "text", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_order_credentials"("p_order_id" "uuid", "p_login" "text", "p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_order_credentials"("p_order_id" "uuid", "p_login" "text", "p_password" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_booster_active_on_accept"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_booster_active_on_accept"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_booster_active_on_accept"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_booster_active_on_message"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_booster_active_on_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_booster_active_on_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_fn_cap_active_clash_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_fn_cap_active_clash_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_cap_active_clash_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_cap_coach_packages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_cap_coach_packages"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_cap_coach_packages"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_fn_cap_pending_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_fn_cap_pending_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_cap_pending_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_booster_display_name_cooldown"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_enforce_message_rate_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_message_rate_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_message_rate_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_enforce_review_rate_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_review_rate_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_enforce_review_rate_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_guard_booster_profile_trust_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_guard_customer_profile_trust_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_guard_notifications_user_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_guard_notifications_user_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_guard_notifications_user_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_guard_profiles_trust_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_guard_profiles_trust_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_guard_profiles_trust_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_fn_lock_chat_on_order_completed"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_fn_lock_chat_on_order_completed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_lock_chat_on_order_completed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_order_completed_booster_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_order_completed_booster_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_order_completed_booster_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_order_paid_customer_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_order_paid_customer_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_order_paid_customer_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_fn_release_duo_account_on_order_end"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_fn_release_duo_account_on_order_end"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_release_duo_account_on_order_end"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_reviews_refresh_booster_rating"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_booster_applications_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_booster_applications_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booster_applications_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_booster_professional_profile"("p_display_name" "text", "p_bio" "text", "p_peak_tier" "text", "p_opgg_link" "text", "p_opgg_link_visible" boolean, "p_available_days" "text"[], "p_hours_per_day_min" integer, "p_hours_per_day_max" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booster_professional_profile"("p_display_name" "text", "p_bio" "text", "p_peak_tier" "text", "p_opgg_link" "text", "p_opgg_link_visible" boolean, "p_available_days" "text"[], "p_hours_per_day_min" integer, "p_hours_per_day_max" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_booster_services_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_booster_services_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booster_services_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_duo_account_rank"("p_account_id" "uuid", "p_tier" "text", "p_division" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_duo_account_rank"("p_account_id" "uuid", "p_tier" "text", "p_division" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_duo_account_rank"("p_account_id" "uuid", "p_tier" "text", "p_division" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_duo_accounts_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_duo_accounts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_duo_accounts_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_my_display_name"("p_display_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_display_name"("p_display_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_my_display_name"("p_display_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order_duo_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order_duo_current_rank"("p_order_id" "uuid", "p_tier" "text", "p_division" "text", "p_lp" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_order_status"("p_order_id" "uuid", "p_new_status" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."win_price_cents"("p_queue" "public"."queue_type", "p_mode" "text", "p_tier" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."win_price_cents"("p_queue" "public"."queue_type", "p_mode" "text", "p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."win_price_cents"("p_queue" "public"."queue_type", "p_mode" "text", "p_tier" "text") TO "service_role";
























GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_drop_requests" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_drop_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."order_drop_requests" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("customer_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("service_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("game_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("queue_type") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("boost_mode") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("server") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("current_rank") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("target_rank") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("wins_purchased") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("sessions_purchased") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("win_package") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("extras") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("base_price") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("extras_price") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("total_price") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("estimated_hours") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("customer_notes") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("wins_played") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("losses_played") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("assigned_booster_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("mp_payment_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("payment_status") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("credentials_set") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("discord_voice_channel_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("completed_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("current_pdl") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("pdl_bracket") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("avg_pdl_gain") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("avg_pdl_loss") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("pricing_version") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("idempotency_key") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("used_exclusive_slot") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("riot_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("booster_service_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("preferred_booster_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("exclusive_until") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("service_type") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("chat_locked") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("chat_locked_by") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("chat_locked_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("credential_expires_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("match_sync_started_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("last_match_synced_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("coupon_code") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("discount_price") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("clash_tier") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("clash_day") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("drop_count") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("rank_before_last_drop") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("last_dropped_at") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("duo_own_riot_id") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("customer_lanes") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("reassigned_by_admin"),INSERT("reassigned_by_admin"),UPDATE("reassigned_by_admin") ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT("duo_current_rank") ON TABLE "public"."orders" TO "authenticated";



GRANT ALL ON TABLE "public"."available_boost_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."available_boost_orders" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_admin_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_admin_notes" TO "service_role";



GRANT ALL ON TABLE "public"."booster_champion_stats" TO "service_role";
GRANT SELECT ON TABLE "public"."booster_champion_stats" TO "anon";
GRANT SELECT ON TABLE "public"."booster_champion_stats" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_duo_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_duo_matches" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."booster_order_events" TO "service_role";
GRANT SELECT ON TABLE "public"."booster_order_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."booster_order_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booster_order_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booster_order_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booster_performance_segments" TO "service_role";
GRANT SELECT ON TABLE "public"."booster_performance_segments" TO "anon";
GRANT SELECT ON TABLE "public"."booster_performance_segments" TO "authenticated";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_profile_events" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_profile_events" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_profile_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booster_profile_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booster_profile_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booster_profile_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_services" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."booster_services" TO "authenticated";
GRANT ALL ON TABLE "public"."booster_services" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."customer_profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."duo_account_events" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."duo_account_events" TO "authenticated";
GRANT ALL ON TABLE "public"."duo_account_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."duo_account_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."duo_account_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."duo_account_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."duo_account_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."duo_account_reservations" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."duo_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."duo_accounts" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."duo_accounts" TO "authenticated";



GRANT SELECT("label") ON TABLE "public"."duo_accounts" TO "authenticated";



GRANT SELECT("current_rank") ON TABLE "public"."duo_accounts" TO "authenticated";



GRANT SELECT("is_active") ON TABLE "public"."duo_accounts" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."duo_accounts" TO "authenticated";



GRANT ALL ON TABLE "public"."edge_rate_limits" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."games" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."master_plus_pricing" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."master_plus_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."master_plus_pricing" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_booster_assignments" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."order_coaching_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."order_coaching_topics" TO "service_role";



GRANT ALL ON TABLE "public"."order_ignored_matches" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."order_matches" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_messages" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."order_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."order_messages" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_rank_verifications" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_rank_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."order_rank_verifications" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_status_events" TO "authenticated";
GRANT ALL ON TABLE "public"."order_status_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_status_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_status_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_status_events_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_status_history" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."order_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."order_status_history" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."payout_records" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."payout_records" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_records" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."payout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_requests" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."public_booster_profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."public_booster_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_booster_profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."refunds" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."refunds" TO "authenticated";
GRANT ALL ON TABLE "public"."refunds" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reviews" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."riot_league_cutoffs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."riot_league_cutoffs" TO "authenticated";
GRANT ALL ON TABLE "public"."riot_league_cutoffs" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."service_extras" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."service_extras" TO "authenticated";
GRANT ALL ON TABLE "public"."service_extras" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."services" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."win_price_cents_catalog" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."win_price_cents_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."win_price_cents_catalog" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































