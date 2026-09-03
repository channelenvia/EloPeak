-- ============================================================
-- EloBoost — Complete Reset & Rebuild (squashed baseline)
--
-- WARNING: DESTRUCTIVE BASELINE MIGRATION.
-- This migration intentionally drops public tables/functions/types/views and
-- deletes all auth.users before rebuilding the schema from scratch. It is the
-- single source of truth for the schema — new schema changes should be added
-- as forward-only migrations on top of this file, not by editing this reset
-- flow, once this has been applied to a shared environment.
--
-- This file replaces the previous chain of 16 incremental migrations
-- (001_initializing.sql ... 20260712180000_duo_accounts.sql), which are kept
-- for historical reference in supabase/migrations/_archive/ but are no longer
-- executed by the Supabase CLI (files there are outside supabase/migrations/,
-- so `supabase db push` / `db reset` only ever sees this one file).
--
-- Why it was squashed: 20260712170000_remove_support_role.sql tried to
-- `drop type public.user_role;` while public.handle_new_user(),
-- public.onboard_booster(...) and public.request_booster_role() still
-- declared local variables of that type — Postgres refuses to drop a type
-- that other objects still depend on, so that migration (and every migration
-- chained after it, including 20260712180000_duo_accounts.sql) failed to
-- apply. Rather than patch the enum-swap dance in place, the full history was
-- squashed into one script that simply creates the enum correctly from the
-- start (no 'support' value, no swap needed) and reflects the true final
-- state of every table/function/policy after all 16 migrations.
--
-- Operational prerequisite (not managed by this file): a Supabase Vault
-- secret named 'credential_key' (>= 32 chars) must exist in this project —
-- it backs pgp_sym_encrypt/decrypt for order and duo-account credentials.
--
-- Run in Supabase SQL Editor (with service_role / postgres context), or via
-- `supabase db reset` / `supabase db push` against a fresh project.
-- ============================================================

-- ─── 1. DROP TRIGGERS ────────────────────────────────────────────────────────
-- Only auth.users needs an explicit drop here: it's a Supabase-managed table
-- that is never dropped by this script, so its trigger would otherwise
-- survive a reset. Every other trigger below lives on a public.* table that
-- gets dropped (with CASCADE) in section 4 — dropping the table already
-- takes its triggers with it, and `DROP TRIGGER IF EXISTS x ON t` still
-- raises "relation t does not exist" when t is missing (IF EXISTS only
-- guards the trigger name, not the table), which would break this script on
-- a genuinely empty database. So they're intentionally not repeated here.

drop trigger if exists on_auth_user_created on auth.users;

-- ─── 2. DROP FUNCTIONS ───────────────────────────────────────────────────────

drop function if exists public.handle_new_user()                                              cascade;
drop function if exists public.ensure_profile_exists(text)                                    cascade;
drop function if exists public.current_user_role()                                            cascade;
drop function if exists public.is_admin()                                                     cascade;
drop function if exists public.booster_active_slot_counts(uuid)                               cascade;
drop function if exists public.can_booster_accept_order(uuid, text)                           cascade;
drop function if exists public.accept_boost_order(uuid, uuid)                                 cascade;
drop function if exists public.refresh_top5_boosters()                                        cascade;
drop function if exists public.trg_order_completed_refresh_top5()                             cascade;
drop function if exists public.update_booster_applications_updated_at()                       cascade;
drop function if exists public.update_order_status(uuid, text, text)                          cascade;
drop function if exists public.admin_override_order_status(uuid, text, text)                  cascade;
drop function if exists public.approve_booster(uuid, text)                                    cascade;
drop function if exists public.toggle_booster_top5(uuid, boolean)                             cascade;
drop function if exists public.assign_ticket(uuid)                                            cascade;
drop function if exists public.moderate_review(uuid, boolean)                                 cascade;
drop function if exists public.update_my_username(text)                                       cascade;
drop function if exists public.log_match_result(uuid, integer, integer)                       cascade;
drop function if exists public.request_order_drop(uuid, text)                                 cascade;
drop function if exists public.resolve_drop_request(uuid, boolean, text)                      cascade;
drop function if exists public.onboard_booster(text, text, jsonb, text, integer, integer, text, text) cascade;
drop function if exists public.onboard_booster(text, text, text[], text[], jsonb)             cascade;
drop function if exists public.onboard_booster(text, text, jsonb, text, integer, integer, text, text, text, text) cascade;
drop function if exists public.set_order_credentials(uuid, text, text)                        cascade;
drop function if exists public.get_order_credentials(uuid)                                    cascade;
drop function if exists public.trg_fn_booster_active_on_message()                              cascade;
drop function if exists public.trg_fn_booster_active_on_accept()                               cascade;
drop function if exists public.request_booster_role()                                         cascade;
drop function if exists public.trg_fn_order_paid_customer_stats()                              cascade;
drop function if exists public.trg_fn_order_completed_booster_stats()                          cascade;
drop function if exists public.expire_stale_pix_orders()                                      cascade;
drop function if exists public.trg_fn_guard_booster_profile_trust_columns()                    cascade;
drop function if exists public.trg_fn_guard_customer_profile_trust_columns()                   cascade;
drop function if exists public.update_duo_accounts_updated_at()                                cascade;
drop function if exists public.set_duo_account_credentials(uuid, text, text)                  cascade;
drop function if exists public.get_duo_account_credentials(uuid)                              cascade;

-- ─── 3. DROP VIEWS ────────────────────────────────────────────────────────────

drop view if exists public.public_booster_profiles cascade;

-- ─── 4. DROP TABLES (children first) ─────────────────────────────────────────

drop table if exists public.duo_accounts         cascade;
drop table if exists public.booster_services     cascade;
drop table if exists public.payout_records       cascade;
drop table if exists public.audit_logs           cascade;
drop table if exists public.notifications        cascade;
drop table if exists public.reviews              cascade;
drop table if exists public.ticket_messages      cascade;
drop table if exists public.support_tickets      cascade;
drop table if exists public.refunds              cascade;
drop table if exists public.payments             cascade;
drop table if exists public.order_drop_requests  cascade;
drop table if exists public.order_messages       cascade;
drop table if exists public.order_status_history cascade;
drop table if exists public.orders               cascade;
drop table if exists public.service_extras       cascade;
drop table if exists public.services             cascade;
drop table if exists public.games                cascade;
drop table if exists public.booster_applications cascade;
drop table if exists public.booster_profiles     cascade;
drop table if exists public.customer_profiles    cascade;
drop table if exists public.profiles             cascade;

-- ─── 0. WIPE ALL USERS ───────────────────────────────────────────────────────
-- Runs AFTER tables are dropped so no FK constraints block the cascade.
delete from auth.users;

-- ─── 5. DROP TYPES ───────────────────────────────────────────────────────────

drop type if exists public.payout_status   cascade;
drop type if exists public.ticket_priority cascade;
drop type if exists public.ticket_status   cascade;
drop type if exists public.payment_status  cascade;
drop type if exists public.booster_status  cascade;
drop type if exists public.order_status    cascade;
drop type if exists public.queue_type      cascade;
drop type if exists public.service_type    cascade;
drop type if exists public.user_role       cascade;

-- ─── 6. EXTENSIONS ───────────────────────────────────────────────────────────

create extension if not exists "pg_trgm";
create extension if not exists "pgcrypto";

do $$
begin
  create extension if not exists pg_cron;
exception when insufficient_privilege then
  raise notice 'pg_cron could not be enabled (insufficient privilege) — schedule expire_stale_pix_orders() manually';
end $$;

-- ─── 7. ENUMS ─────────────────────────────────────────────────────────────────
-- user_role has only ever needed 'customer' / 'booster' / 'admin' — 'support'
-- existed briefly but was never treated differently from 'admin' anywhere in
-- the app (is_admin() always matched both), so it is not recreated here.

create type public.user_role      as enum ('customer', 'booster', 'admin');
create type public.service_type   as enum ('elo_boost', 'win_boost', 'coaching', 'placement_matches', 'md5');
create type public.queue_type     as enum ('solo_duo', 'flex');
create type public.order_status   as enum (
  'draft', 'awaiting_payment', 'paid', 'awaiting_assignment',
  'assigned', 'in_progress', 'paused', 'drop_requested', 'awaiting_customer',
  'completed', 'disputed', 'refunded', 'canceled'
);
create type public.booster_status as enum ('pending', 'under_review', 'approved', 'suspended', 'rejected');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'disputed');
create type public.ticket_status  as enum ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.payout_status  as enum ('pending', 'processing', 'paid', 'failed');

-- ─── 8. TABLES ────────────────────────────────────────────────────────────────

-- profiles (extends auth.users)
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null unique,
  role                 public.user_role not null default 'customer',
  username             text not null unique,
  avatar_url           text,
  discord_id           text,
  terms_accepted_at    timestamptz,
  privacy_accepted_at  timestamptz,
  legal_version        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index profiles_email_idx on public.profiles(email);
create index profiles_role_idx  on public.profiles(role);

-- customer_profiles
create table public.customer_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles(id) on delete cascade,
  display_name        text,
  country             text,
  preferred_language  text default 'en',
  total_orders        integer not null default 0,
  total_spent         numeric(10,2) not null default 0,
  created_at          timestamptz not null default now()
);

create index customer_profiles_user_id_idx on public.customer_profiles(user_id);

-- booster_profiles
create table public.booster_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles(id) on delete cascade,
  display_name        text not null,
  status              public.booster_status not null default 'pending',
  bio                 text,
  peak_rank           jsonb,
  current_rank        jsonb,
  games               text[] not null default '{}',
  queue_preferences   text[] not null default '{}',
  region_preferences  text[] not null default '{}',
  lanes               text[],
  specialties         text[],
  can_coach           boolean,
  available_days      text[],
  total_completed     integer not null default 0,
  total_earnings      numeric(10,2) not null default 0,
  rating              numeric(3,2) not null default 0,
  rating_count        integer not null default 0,
  is_available        boolean not null default false,
  is_top5             boolean not null default false,
  rank_stats          jsonb,
  last_active_at      timestamptz,
  opgg_link           text,
  hours_per_day_min   smallint,
  hours_per_day_max   smallint,
  full_name           text,
  email               text,
  cpf                 text,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index booster_profiles_status_idx    on public.booster_profiles(status);
create index booster_profiles_available_idx on public.booster_profiles(is_available) where is_available = true;
create index booster_profiles_top5_idx      on public.booster_profiles(is_top5) where is_top5 = true;

-- games (slug as text — only lol is active)
create table public.games (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  icon_url    text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0
);

-- services
create table public.services (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id),
  type              public.service_type not null,
  name              text not null,
  description       text,
  short_description text,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  unique(game_id, type)
);

-- service_extras
create table public.service_extras (
  id                  uuid primary key default gen_random_uuid(),
  service_id          uuid references public.services(id) on delete cascade,
  name                text not null,
  description         text not null,
  price_modifier      numeric(8,2) not null default 0,
  price_modifier_pct  numeric(5,2) not null default 0,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  icon                text
);

-- orders
create table public.orders (
  id                       uuid primary key default gen_random_uuid(),
  customer_id              uuid not null references public.profiles(id),
  service_id               text not null,
  game_id                  text not null,
  status                   public.order_status not null default 'draft',
  queue_type               public.queue_type not null default 'solo_duo',
  boost_mode               text not null default 'solo' check (boost_mode in ('solo', 'duo')),
  server                   text not null,
  current_rank             jsonb not null,
  target_rank              jsonb,
  wins_purchased           integer,
  sessions_purchased       integer,
  win_package              smallint check (win_package in (1, 3, 5)),
  extras                   jsonb not null default '[]',
  base_price               numeric(10,2) not null,
  extras_price             numeric(10,2) not null default 0,
  total_price              numeric(10,2) not null,
  estimated_hours          integer,
  customer_notes           text,
  booster_notes            text,
  wins_played              integer not null default 0,
  losses_played            integer not null default 0,
  assigned_booster_id      uuid references public.profiles(id),
  mp_payment_id            text unique,
  payment_status           public.payment_status,
  game_credentials         text,     -- pgp_sym_encrypt(login||'|'||senha, chave)
  credentials_set          boolean not null default false,
  discord_voice_channel_id text,
  completed_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index orders_customer_id_idx  on public.orders(customer_id);
create index orders_status_idx       on public.orders(status);
create index orders_booster_id_idx   on public.orders(assigned_booster_id);
create index orders_created_at_idx   on public.orders(created_at desc);

-- order_status_history
create table public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid not null references public.profiles(id),
  reason      text,
  created_at  timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history(order_id);

-- order_messages
create table public.order_messages (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id),
  sender_role    public.user_role not null,
  content        text not null,
  attachment_url text,
  is_read        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index order_messages_order_idx  on public.order_messages(order_id);
create index order_messages_sender_idx on public.order_messages(sender_id);

-- order_drop_requests
create table public.order_drop_requests (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  booster_id         uuid not null references public.profiles(id),
  reason             text not null,
  wins_at_request    integer not null default 0,
  losses_at_request  integer not null default 0,
  penalty_pct        integer not null default 0,
  penalty_amount     numeric(10,2) not null default 0,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  admin_id           uuid references public.profiles(id),
  admin_note         text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

-- payments
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  customer_id         uuid not null references public.profiles(id),
  mp_payment_id       text not null unique,
  amount              numeric(10,2) not null,
  currency            text not null default 'brl',
  status              public.payment_status not null default 'pending',
  payment_method_type text,
  webhook_event_id    text unique,
  refunded_amount     numeric(10,2) not null default 0,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index payments_order_idx    on public.payments(order_id);
create index payments_customer_idx on public.payments(customer_id);
create index payments_status_idx   on public.payments(status);

-- refunds
create table public.refunds (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments(id),
  order_id      uuid not null references public.orders(id),
  mp_refund_id  text not null unique,
  amount        numeric(10,2) not null,
  reason        text not null,
  initiated_by  uuid not null references public.profiles(id),
  status        text not null default 'pending',
  created_at    timestamptz not null default now()
);

-- support_tickets
create table public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles(id),
  order_id     uuid references public.orders(id),
  assigned_to  uuid references public.profiles(id),
  status       public.ticket_status not null default 'open',
  priority     public.ticket_priority not null default 'medium',
  subject      text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index tickets_customer_idx on public.support_tickets(customer_id);
create index tickets_status_idx   on public.support_tickets(status);
create index tickets_priority_idx on public.support_tickets(priority);

-- ticket_messages
create table public.ticket_messages (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.support_tickets(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id),
  sender_role    public.user_role not null,
  content        text not null,
  is_internal    boolean not null default false,
  attachment_url text,
  created_at     timestamptz not null default now()
);

create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id);

-- reviews
create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references public.orders(id),
  customer_id  uuid not null references public.profiles(id),
  booster_id   uuid references public.profiles(id),
  rating       smallint not null check (rating between 1 and 5),
  content      text,
  is_public    boolean not null default true,
  is_moderated boolean not null default false,
  admin_note   text,
  created_at   timestamptz not null default now()
);

create index reviews_booster_idx on public.reviews(booster_id);
create index reviews_public_idx  on public.reviews(is_public) where is_public = true;

-- notifications
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null,
  data       jsonb not null default '{}',
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx   on public.notifications(user_id);
create index notifications_unread_idx on public.notifications(user_id, is_read) where is_read = false;

-- audit_logs
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references public.profiles(id),
  actor_role  public.user_role not null,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  diff        jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index audit_logs_actor_idx      on public.audit_logs(actor_id);
create index audit_logs_entity_idx     on public.audit_logs(entity_type, entity_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

-- payout_records
create table public.payout_records (
  id                uuid primary key default gen_random_uuid(),
  booster_id        uuid not null references public.profiles(id),
  order_id          uuid not null references public.orders(id),
  gross_amount      numeric(10,2) not null,
  commission_rate   numeric(5,4) not null default 0.25,
  commission_amount numeric(10,2) not null,
  net_amount        numeric(10,2) not null,
  status            public.payout_status not null default 'pending',
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index payout_records_booster_idx on public.payout_records(booster_id);
create index payout_records_status_idx  on public.payout_records(status);

-- booster_applications (public apply form)
create table public.booster_applications (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  user_id          uuid references public.profiles(id) on delete set null,
  summoner_name    text not null,
  opgg_link        text,
  region           text not null,
  peak_rank        text not null,
  roles            text[] not null default '{}',
  games            text[] not null default '{}',
  has_coaching     boolean not null default false,
  available_days   text[] not null default '{}',
  hours_per_week   integer not null,
  years_experience numeric(4,1) not null,
  discord_tag      text,
  motivation       text not null,
  full_name        text,
  email            text,
  phone            text,
  cpf              text,
  status           text not null default 'pending'
                     check (status in ('pending', 'under_review', 'accepted', 'rejected')),
  admin_notes      text
);

create index booster_applications_status_idx     on public.booster_applications(status);
create index booster_applications_created_at_idx on public.booster_applications(created_at desc);

-- booster_services (catálogo de serviços próprios do booster)
create table public.booster_services (
  id           uuid primary key default gen_random_uuid(),
  booster_id   uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  description  text,
  tempo        text,
  price        numeric(10,2) not null default 0,
  created_at   timestamptz default now()
);

create index booster_services_booster_idx on public.booster_services(booster_id);

-- duo_accounts (contas smurf de propriedade da empresa, para Duo Boost)
create table public.duo_accounts (
  id                     uuid primary key default gen_random_uuid(),
  game_id                text not null default 'lol',
  label                  text not null,                 -- ex.: "Conta Duo #3" — visível para o booster
  current_rank           jsonb,                          -- { tier, division } opcional, contexto pro booster
  notes                  text,                           -- observações internas (somente admin)
  encrypted_credentials  text,                           -- pgp_sym_encrypt(login||'|'||senha, chave)
  is_active              boolean not null default true,
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index duo_accounts_active_idx on public.duo_accounts(is_active);

-- ─── 9. VIEWS ─────────────────────────────────────────────────────────────────
--
-- Public, PII-safe view of approved boosters. No broad RLS policy is added to
-- booster_profiles for anon/authenticated because that would expose columns
-- with PII (email, cpf, full_name, total_earnings). security_barrier ensures
-- the status='approved' filter is applied before any caller-supplied
-- condition — no infer-via-filter risk.

create or replace view public.public_booster_profiles
  with (security_barrier = true) as
select
  id,
  user_id,
  display_name,
  bio,
  current_rank,
  peak_rank,
  games,
  rating,
  rating_count,
  total_completed,
  is_available,
  is_top5,
  rank_stats,
  last_active_at,
  updated_at
from public.booster_profiles
where status = 'approved';

-- ─── 10. FUNCTIONS ────────────────────────────────────────────────────────────

-- Helper: current_user_role
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Helper: is_admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  )
$$;

-- Trigger: handle_new_user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
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
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1),
    'user'
  );
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

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RPC: ensure_profile_exists
create or replace function public.ensure_profile_exists(p_display_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
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

-- Trigger: booster_applications updated_at
create or replace function public.update_booster_applications_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_booster_applications_updated_at
  before update on public.booster_applications
  for each row execute function public.update_booster_applications_updated_at();

-- Helper: booster_active_slot_counts (security-hardened)
create or replace function public.booster_active_slot_counts(p_booster_user_id uuid)
returns table(solo_count integer, duo_count integer, total_count integer)
language plpgsql stable security definer set search_path = public as $$
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
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer');
end;
$$;

-- RPC: can_booster_accept_order
-- Normal: 3 pedidos total, máx 1 duo. Top5: 3 pedidos total, máx 2 duo.
create or replace function public.can_booster_accept_order(
  p_booster_user_id uuid,
  p_boost_mode      text
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_top5     boolean;
  v_max_total   integer;
  v_max_duo     integer;
  v_solo_count  integer;
  v_duo_count   integer;
  v_total_count integer;
begin
  select is_top5 into v_is_top5
  from public.booster_profiles
  where user_id = p_booster_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'booster_not_approved');
  end if;

  if v_is_top5 then
    v_max_total := 3; v_max_duo := 2;
  else
    v_max_total := 3; v_max_duo := 1;
  end if;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top5', v_is_top5
    );
  end if;

  if p_boost_mode = 'duo' and v_duo_count >= v_max_duo then
    return jsonb_build_object(
      'allowed', false, 'reason', 'duo_slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top5', v_is_top5
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'max_duo', v_max_duo, 'is_top5', v_is_top5
  );
end;
$$;

-- RPC: accept_boost_order
create or replace function public.accept_boost_order(
  p_order_id        uuid,
  p_booster_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_check jsonb;
begin
  if auth.uid() is distinct from p_booster_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status, boost_mode into v_order
  from   public.orders
  where  id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if v_order.status <> 'awaiting_assignment' then
    return jsonb_build_object('success', false, 'error', 'order_no_longer_available');
  end if;

  v_check := public.can_booster_accept_order(p_booster_user_id, v_order.boost_mode);

  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('success', false, 'error', v_check->>'reason', 'details', v_check);
  end if;

  update public.orders
  set    status = 'assigned', assigned_booster_id = p_booster_user_id, updated_at = now()
  where  id = p_order_id;

  return jsonb_build_object('success', true, 'details', v_check);
end;
$$;

-- RPC: refresh_top5_boosters
create or replace function public.refresh_top5_boosters()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_top5_ids uuid[];
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  select array_agg(sub.user_id) into v_top5_ids
  from (
    select bp.user_id
    from   public.booster_profiles bp
    join   public.orders o on o.assigned_booster_id = bp.user_id
    where  o.status = 'completed'
      and  date_trunc('month', o.completed_at) = date_trunc('month', now())
    group  by bp.user_id
    order  by count(*) desc
    limit  5
  ) sub;

  update public.booster_profiles set is_top5 = false where is_top5 = true;

  if v_top5_ids is not null and array_length(v_top5_ids, 1) > 0 then
    update public.booster_profiles set is_top5 = true where user_id = any(v_top5_ids);
  end if;
end;
$$;

-- Trigger function: refresh top5 on order completion
create or replace function public.trg_order_completed_refresh_top5()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    perform public.refresh_top5_boosters();
  end if;
  return new;
end;
$$;

create trigger order_completed_refresh_top5
  after update on public.orders
  for each row execute function public.trg_order_completed_refresh_top5();

-- RPC: update_order_status
-- Boosters may only transition to: in_progress, paused, awaiting_customer.
-- completed / canceled / refunded / disputed are reserved for admin_override_order_status.
create or replace function public.update_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order                record;
  v_booster_allowed_set  constant text[] := array['in_progress', 'paused', 'awaiting_customer'];
begin
  select id, status, assigned_booster_id into v_order
  from   public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Boosters can only move orders through their allowed transitions
  if auth.uid() = v_order.assigned_booster_id and not public.is_admin() then
    if not (p_new_status = any(v_booster_allowed_set)) then
      return jsonb_build_object('success', false, 'error', 'invalid_transition_for_booster');
    end if;
  end if;

  update public.orders set status = p_new_status::public.order_status, updated_at = now()
  where  id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_new_status::public.order_status, auth.uid(), p_reason);

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: admin_override_order_status
create or replace function public.admin_override_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_reason     text default 'Admin override'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, status into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.orders set status = p_new_status::public.order_status, updated_at = now()
  where  id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_new_status::public.order_status, auth.uid(), p_reason);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'order.status_override', 'order', p_order_id::text,
          jsonb_build_object('from', v_order.status, 'to', p_new_status));

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: approve_booster
create or replace function public.approve_booster(
  p_booster_id uuid,
  p_new_status text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set    status      = p_new_status::public.booster_status,
         verified_at = case when p_new_status = 'approved' then now() else null end,
         updated_at  = now()
  where  id = p_booster_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role, 'booster.' || p_new_status, 'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: toggle_booster_top5
create or replace function public.toggle_booster_top5(
  p_booster_id uuid,
  p_is_top5    boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set is_top5 = p_is_top5, updated_at = now()
  where id = p_booster_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role,
          case when p_is_top5 then 'booster.top5_granted' else 'booster.top5_removed' end,
          'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: assign_ticket
create or replace function public.assign_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.support_tickets
  set assigned_to = auth.uid(), status = 'in_progress', updated_at = now()
  where id = p_ticket_id;

  if not found then return jsonb_build_object('success', false, 'error', 'ticket_not_found'); end if;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: moderate_review
create or replace function public.moderate_review(
  p_review_id uuid,
  p_is_public  boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.reviews set is_public = p_is_public, is_moderated = true where id = p_review_id;
  if not found then return jsonb_build_object('success', false, 'error', 'review_not_found'); end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (v_actor.id, v_actor.role, 'review.moderated', 'review', p_review_id::text,
          jsonb_build_object('is_public', p_is_public));

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: update_my_username
create or replace function public.update_my_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.profiles where username = p_username and id <> auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'username_taken');
  end if;

  update public.profiles set username = p_username, updated_at = now() where id = auth.uid();
  return jsonb_build_object('success', true);
end;
$$;

-- RPC: log_match_result
create or replace function public.log_match_result(
  p_order_id uuid,
  p_wins     integer,
  p_losses   integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  select id, status, assigned_booster_id into v_order
  from   public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if p_wins < 0 or p_losses < 0 then return jsonb_build_object('success', false, 'error', 'invalid_values'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status not in ('in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.orders
  set    wins_played = p_wins, losses_played = p_losses, updated_at = now()
  where  id = p_order_id and p_wins >= wins_played and p_losses >= losses_played;

  if not found then return jsonb_build_object('success', false, 'error', 'cannot_decrease_counters'); end if;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: request_order_drop
create or replace function public.request_order_drop(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order       record;
  v_penalty_pct integer;
  v_penalty_amt numeric(10,2);
  v_existing    uuid;
begin
  select id, status, assigned_booster_id, wins_played, losses_played, total_price
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'in_progress' then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_penalty_pct := case
    when v_order.wins_played = 0            then 0
    when v_order.wins_played between 1 and 2 then 10
    else 20
  end;
  v_penalty_amt := round(v_order.total_price * v_penalty_pct / 100.0, 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount)
  values (p_order_id, auth.uid(), p_reason,
    v_order.wins_played, v_order.losses_played, v_penalty_pct, v_penalty_amt);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), p_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_penalty_pct, 'penalty_amount', v_penalty_amt);
end;
$$;

-- RPC: resolve_drop_request
create or replace function public.resolve_drop_request(
  p_request_id uuid,
  p_approve    boolean,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req   record;
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.penalty_amount, r.status
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    update public.orders set status = 'canceled', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'canceled', auth.uid(), 'Drop request approved');
    if v_req.penalty_amount > 0 then
      update public.booster_profiles
      set    total_earnings = greatest(0, total_earnings - v_req.penalty_amount)
      where  user_id = v_req.booster_id;
    end if;
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'penalty_amount', v_req.penalty_amount));
  else
    update public.orders set status = 'in_progress', updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', 'in_progress', auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));
  end if;

  update public.order_drop_requests
  set    status      = case when p_approve then 'approved' else 'rejected' end,
         admin_id    = auth.uid(),
         admin_note  = p_admin_note,
         resolved_at = now()
  where  id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: onboard_booster
create or replace function public.onboard_booster(
  p_display_name      text,
  p_bio               text,
  p_peak_rank         jsonb,
  p_opgg_link         text    default null,
  p_hours_per_day_min integer default null,
  p_hours_per_day_max integer default null,
  p_full_name         text    default null,
  p_cpf               text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role  public.user_role;
  v_email text;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is distinct from 'booster' then
    return jsonb_build_object('success', false, 'error', 'not_a_booster');
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.booster_profiles(
    user_id, display_name, bio, status,
    peak_rank, opgg_link, hours_per_day_min, hours_per_day_max,
    full_name, email, cpf
  )
  values (
    auth.uid(), p_display_name, nullif(p_bio, ''), 'pending',
    p_peak_rank, nullif(p_opgg_link, ''), p_hours_per_day_min, p_hours_per_day_max,
    nullif(p_full_name, ''), v_email, nullif(p_cpf, '')
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
    updated_at        = now();

  return jsonb_build_object('success', true);
end;
$$;

-- ─── Credenciais de conta no pedido ───────────────────────────────────────────
-- Armazena login + senha da conta do cliente, criptografados com pgp_sym_encrypt.
-- A chave de criptografia vem do Supabase Vault ('credential_key'), nunca do cliente.

-- RPC: set_order_credentials (cliente define as credenciais do pedido)
create or replace function public.set_order_credentials(
  p_order_id uuid,
  p_login    text,
  p_password text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_key   text;
begin
  select id, customer_id, status into v_order
  from   public.orders
  where  id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if v_order.status in ('completed', 'canceled', 'refunded', 'disputed') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  update public.orders
  set
    game_credentials = pgp_sym_encrypt(p_login || '|' || p_password, v_key),
    credentials_set  = true,
    updated_at       = now()
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: get_order_credentials (apenas booster atribuído ou admin pode ler)
create or replace function public.get_order_credentials(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order     record;
  v_key       text;
  v_decrypted text;
  v_parts     text[];
begin
  select id, customer_id, assigned_booster_id, game_credentials, credentials_set
  into   v_order
  from   public.orders
  where  id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;

  if auth.uid() is distinct from v_order.assigned_booster_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not v_order.credentials_set or v_order.game_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(v_order.game_credentials::bytea, v_key);
  exception when others then
    return jsonb_build_object('success', false, 'error', 'decrypt_failed');
  end;

  v_parts := string_to_array(v_decrypted, '|');

  return jsonb_build_object(
    'success', true,
    'login',    v_parts[1],
    'password', v_parts[2]
  );
end;
$$;

-- ─── Página pública de boosters: last_active_at ───────────────────────────────

-- Quando booster envia mensagem no chat
create or replace function public.trg_fn_booster_active_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.sender_role = 'booster' then
    update public.booster_profiles
      set last_active_at = now()
      where user_id = NEW.sender_id;
  end if;
  return NEW;
end;
$$;

create trigger trg_booster_active_on_message
  after insert on public.order_messages
  for each row execute function public.trg_fn_booster_active_on_message();

-- Quando booster é atribuído a um pedido (aceita o job)
create or replace function public.trg_fn_booster_active_on_accept()
returns trigger language plpgsql security definer set search_path = public as $$
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

create trigger trg_booster_active_on_accept
  after update of assigned_booster_id on public.orders
  for each row execute function public.trg_fn_booster_active_on_accept();

-- ─── profiles.role: customer → booster ────────────────────────────────────────
-- Usada em BoosterApplyPage.tsx ao iniciar a candidatura de booster. Nunca
-- aceita um role vindo do cliente — só promove o próprio auth.uid() e só a
-- partir de 'customer', igual ao guard já existente em profiles_update_own
-- contra auto-escalonamento de privilégio.

create or replace function public.request_booster_role()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_role <> 'customer' then
    return jsonb_build_object('success', false, 'error', 'invalid_role');
  end if;

  update public.profiles set role = 'booster', updated_at = now() where id = auth.uid();

  return jsonb_build_object('success', true);
end;
$$;

-- ─── Estatísticas agregadas + expiração de pedidos ───────────────────────────

-- Stats do cliente: no momento em que o pagamento é confirmado
-- (transição awaiting_payment → awaiting_assignment, feita pelo webhook do MP)
create or replace function public.trg_fn_order_paid_customer_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'awaiting_assignment' and OLD.status = 'awaiting_payment' then
    update public.customer_profiles
      set total_orders = total_orders + 1,
          total_spent  = total_spent + NEW.total_price
      where user_id = NEW.customer_id;
  end if;
  return NEW;
end;
$$;

create trigger trg_order_paid_customer_stats
  after update of status on public.orders
  for each row execute function public.trg_fn_order_paid_customer_stats();

-- Stats do booster + payout_records: no momento da conclusão
-- Comissão de 25% (mesmo default já usado na coluna payout_records.commission_rate).
create or replace function public.trg_fn_order_completed_booster_stats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_commission_rate   constant numeric(5,4) := 0.25;
  v_commission_amount numeric(10,2);
  v_net_amount        numeric(10,2);
begin
  if NEW.status = 'completed'
     and OLD.status is distinct from 'completed'
     and NEW.assigned_booster_id is not null
  then
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
    );
  end if;
  return NEW;
end;
$$;

create trigger trg_order_completed_booster_stats
  after update of status on public.orders
  for each row execute function public.trg_fn_order_completed_booster_stats();

-- Expiração de pedidos presos em awaiting_payment.
-- Não existe status "expired" no enum order_status — o mais próximo
-- semanticamente é "canceled" (nunca chegou a ser pago). O PIX em si expira
-- em 30 min (StepPayment.tsx / create-pix-payment), então 35 min de folga
-- garante que não cancelamos um pedido que ainda pode ser pago.
create or replace function public.expire_stale_pix_orders()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders
  set status = 'canceled', updated_at = now()
  where status = 'awaiting_payment'
    and created_at < now() - interval '35 minutes';
end;
$$;

do $$
begin
  perform cron.unschedule('expire-stale-pix-orders');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'expire-stale-pix-orders',
    '*/10 * * * *',
    $cron$select public.expire_stale_pix_orders();$cron$
  );
exception when others then
  raise notice 'pg_cron scheduling unavailable — expire_stale_pix_orders() exists but is not scheduled';
end $$;

-- ─── Trava colunas de confiança/financeiras contra auto-alteração do cliente ──
-- customer_profiles/booster_profiles não têm WITH CHECK nas policies de
-- update, então qualquer authenticated poderia, via update direto do browser,
-- alterar total_earnings, total_completed, rating, rating_count, is_top5,
-- status, verified_at, current_rank, rank_stats (booster) ou total_orders/
-- total_spent (customer) — colunas que só devem mudar via RPC SECURITY
-- DEFINER ou pelas triggers de stats acima. Trigger BEFORE UPDATE reverte
-- essas colunas para o valor anterior quando quem executa não é admin nem um
-- contexto de sistema (service_role/RPC/pg_cron/migration nunca rodam como
-- `authenticated`).

create or replace function public.trg_fn_guard_booster_profile_trust_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status          := old.status;
    new.total_completed := old.total_completed;
    new.total_earnings  := old.total_earnings;
    new.rating          := old.rating;
    new.rating_count    := old.rating_count;
    new.is_top5         := old.is_top5;
    new.verified_at     := old.verified_at;
    new.current_rank    := old.current_rank;
    new.rank_stats      := old.rank_stats;
  end if;
  return new;
end;
$$;

create trigger trg_guard_booster_profile_trust_columns
  before update on public.booster_profiles
  for each row execute function public.trg_fn_guard_booster_profile_trust_columns();

create or replace function public.trg_fn_guard_customer_profile_trust_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.total_orders := old.total_orders;
    new.total_spent  := old.total_spent;
  end if;
  return new;
end;
$$;

create trigger trg_guard_customer_profile_trust_columns
  before update on public.customer_profiles
  for each row execute function public.trg_fn_guard_customer_profile_trust_columns();

-- ─── Pool de contas duo boost da empresa ──────────────────────────────────────

create or replace function public.update_duo_accounts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_duo_accounts_updated_at
  before update on public.duo_accounts
  for each row execute function public.update_duo_accounts_updated_at();

-- RPC: admin define/atualiza login+senha da conta duo
create or replace function public.set_duo_account_credentials(
  p_account_id uuid,
  p_login      text,
  p_password   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not exists (select 1 from public.duo_accounts where id = p_account_id) then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  update public.duo_accounts
  set
    encrypted_credentials = pgp_sym_encrypt(p_login || '|' || p_password, v_key),
    updated_at            = now()
  where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.credentials_set', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: booster aprovado (ou admin) revela login+senha da conta duo
create or replace function public.get_duo_account_credentials(p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_account   record;
  v_key       text;
  v_decrypted text;
  v_parts     text[];
  v_is_booster boolean;
begin
  select id, is_active, encrypted_credentials
  into   v_account
  from   public.duo_accounts
  where  id = p_account_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  select exists (
    select 1 from public.booster_profiles
    where user_id = auth.uid() and status = 'approved'
  ) into v_is_booster;

  if not public.is_admin() and not v_is_booster then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not v_account.is_active and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'account_inactive');
  end if;

  if v_account.encrypted_credentials is null then
    return jsonb_build_object('success', false, 'error', 'no_credentials');
  end if;

  select decrypted_secret into v_key
  from   vault.decrypted_secrets
  where  name = 'credential_key'
  limit  1;

  if v_key is null or length(v_key) < 32 then
    return jsonb_build_object('success', false, 'error', 'server_key_not_configured');
  end if;

  begin
    v_decrypted := pgp_sym_decrypt(v_account.encrypted_credentials::bytea, v_key);
  exception when others then
    return jsonb_build_object('success', false, 'error', 'decrypt_failed');
  end;

  v_parts := string_to_array(v_decrypted, '|');

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.credentials_viewed', 'duo_account', p_account_id::text);

  return jsonb_build_object(
    'success', true,
    'login',    v_parts[1],
    'password', v_parts[2]
  );
end;
$$;

-- ─── 11. ROW LEVEL SECURITY ───────────────────────────────────────────────────

alter table public.profiles              enable row level security;
alter table public.customer_profiles     enable row level security;
alter table public.booster_profiles      enable row level security;
alter table public.games                 enable row level security;
alter table public.services              enable row level security;
alter table public.service_extras        enable row level security;
alter table public.orders                enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.order_messages        enable row level security;
alter table public.order_drop_requests   enable row level security;
alter table public.payments              enable row level security;
alter table public.refunds               enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.ticket_messages       enable row level security;
alter table public.reviews               enable row level security;
alter table public.notifications         enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.payout_records        enable row level security;
alter table public.booster_applications  enable row level security;
alter table public.booster_services      enable row level security;
alter table public.duo_accounts          enable row level security;

-- profiles
create policy "profiles_read_own"   on public.profiles for select using (id = auth.uid() or public.is_admin());
-- WITH CHECK prevents users from escalating their own role via a direct UPDATE
create policy "profiles_update_own" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- customer_profiles
create policy "customer_profiles_read_own"   on public.customer_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy "customer_profiles_update_own" on public.customer_profiles for update using (user_id = auth.uid());
create policy "customer_profiles_insert_own" on public.customer_profiles for insert with check (user_id = auth.uid());

-- booster_profiles
create policy "booster_profiles_read_own_or_admin"   on public.booster_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy "booster_profiles_insert_own"          on public.booster_profiles for insert with check (user_id = auth.uid());
create policy "booster_profiles_update_own_or_admin" on public.booster_profiles for update using (user_id = auth.uid() or public.is_admin());

-- games & services (public read)
create policy "games_public_read"  on public.games for select using (is_active = true or public.is_admin());
create policy "games_admin_write"  on public.games for all   using (public.is_admin());

create policy "services_public_read"  on public.services for select using (is_active = true or public.is_admin());
create policy "services_admin_write"  on public.services for all   using (public.is_admin());

create policy "service_extras_public_read"  on public.service_extras for select using (is_active = true or public.is_admin());
create policy "service_extras_admin_write"  on public.service_extras for all   using (public.is_admin());

-- orders
-- No customer INSERT policy: order creation goes through the create-pix-payment
-- Edge Function (service role, bypasses RLS), which recalculates the price
-- server-side from shared/pricing.ts — the client never inserts orders directly.
create policy "orders_customer_read" on public.orders for select using (
  customer_id = auth.uid() or assigned_booster_id = auth.uid() or public.is_admin()
);
-- Direct client UPDATE is admin-only: every legitimate status transition
-- (booster and admin) goes through the SECURITY DEFINER RPCs
-- (update_order_status / admin_override_order_status / accept_boost_order),
-- which bypass RLS.
create policy "orders_update" on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- order_status_history (writes happen via SECURITY DEFINER RPCs; direct
-- client insert restricted to admin)
create policy "order_status_history_read" on public.order_status_history for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  ) or public.is_admin()
);
create policy "order_status_history_insert" on public.order_status_history for insert
  with check (public.is_admin());

-- order_messages
create policy "order_messages_read" on public.order_messages for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  ) or public.is_admin()
);
create policy "order_messages_insert" on public.order_messages for insert with check (
  sender_id = auth.uid()
  and (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
    )
    or public.is_admin()
  )
);

-- order_drop_requests (no INSERT policy — all writes via SECURITY DEFINER RPC)
create policy "boosters_select_own_drop_requests" on public.order_drop_requests
  for select to authenticated using (booster_id = auth.uid() or public.is_admin());
create policy "admins_update_drop_requests" on public.order_drop_requests
  for update to authenticated using (public.is_admin());

-- payments
create policy "payments_read"      on public.payments for select using (customer_id = auth.uid() or public.is_admin());
create policy "payments_admin_all" on public.payments for all   using (public.is_admin());

-- refunds
create policy "refunds_read" on public.refunds for select using (
  exists (select 1 from public.payments p where p.id = payment_id and p.customer_id = auth.uid())
  or public.is_admin()
);

-- support_tickets
create policy "tickets_customer_read"   on public.support_tickets for select using (customer_id = auth.uid() or public.is_admin());
create policy "tickets_customer_insert" on public.support_tickets for insert with check (customer_id = auth.uid());
create policy "tickets_update"          on public.support_tickets for update using (customer_id = auth.uid() or public.is_admin());

-- ticket_messages
create policy "ticket_messages_read" on public.ticket_messages for select using (
  (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.customer_id = auth.uid()
    )
    and is_internal = false
  ) or public.is_admin()
);
create policy "ticket_messages_insert" on public.ticket_messages for insert with check (
  sender_id = auth.uid()
  and (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.customer_id = auth.uid() or t.assigned_to = auth.uid())
    )
    or public.is_admin()
  )
);

-- reviews
create policy "reviews_public_read" on public.reviews for select using (
  is_public = true or customer_id = auth.uid() or public.is_admin()
);
create policy "reviews_customer_insert" on public.reviews for insert with check (
  customer_id = auth.uid()
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = auth.uid() and o.status = 'completed'
  )
);

-- notifications
create policy "notifications_read_own"   on public.notifications for select using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update using (user_id = auth.uid());

-- audit_logs (writes happen via SECURITY DEFINER RPCs; direct client insert
-- restricted to admin)
create policy "audit_logs_admin_read" on public.audit_logs for select using (public.is_admin());
create policy "audit_logs_insert"     on public.audit_logs for insert with check (public.is_admin());

-- payout_records
create policy "payout_records_read" on public.payout_records for select using (booster_id = auth.uid() or public.is_admin());

-- booster_applications
create policy "Anyone can submit an application" on public.booster_applications
  for insert with check (true);
create policy "Admins can manage applications" on public.booster_applications
  for all using (public.is_admin());

-- booster_services
create policy "booster_services_owner_all" on public.booster_services
  for all
  using (booster_id = auth.uid())
  with check (booster_id = auth.uid());
create policy "booster_services_public_read" on public.booster_services
  for select
  using (
    exists (
      select 1 from public.booster_profiles bp
      where bp.user_id = booster_services.booster_id
        and bp.status = 'approved'
    )
  );

-- duo_accounts
-- Leitura: admin sempre; booster aprovado só enquanto a conta estiver ativa.
create policy "duo_accounts_read" on public.duo_accounts for select using (
  public.is_admin()
  or (
    is_active
    and exists (
      select 1 from public.booster_profiles bp
      where bp.user_id = auth.uid() and bp.status = 'approved'
    )
  )
);
-- Escrita (insert/update/delete) de metadados: somente admin.
create policy "duo_accounts_admin_write" on public.duo_accounts for all using (public.is_admin());

-- ─── 12. GRANTS ───────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;

-- booster_applications: anon can insert (public form)
grant insert on public.booster_applications to anon, authenticated;
grant select on public.booster_applications to authenticated;

-- public_booster_profiles view: safe columns only, no table-level policy needed
grant select on public.public_booster_profiles to anon, authenticated;

-- booster_services
grant select, insert, update, delete on public.booster_services to authenticated;
grant select on public.booster_services to anon;

-- RPCs
grant execute on function public.ensure_profile_exists(text)                                    to authenticated;
grant execute on function public.current_user_role()                                            to authenticated;
grant execute on function public.is_admin()                                                     to authenticated;
grant execute on function public.booster_active_slot_counts(uuid)                               to authenticated;
grant execute on function public.can_booster_accept_order(uuid, text)                           to authenticated;
grant execute on function public.accept_boost_order(uuid, uuid)                                 to authenticated;
grant execute on function public.refresh_top5_boosters()                                        to authenticated;
grant execute on function public.update_order_status(uuid, text, text)                          to authenticated;
grant execute on function public.admin_override_order_status(uuid, text, text)                  to authenticated;
grant execute on function public.approve_booster(uuid, text)                                    to authenticated;
grant execute on function public.toggle_booster_top5(uuid, boolean)                             to authenticated;
grant execute on function public.assign_ticket(uuid)                                            to authenticated;
grant execute on function public.moderate_review(uuid, boolean)                                 to authenticated;
grant execute on function public.update_my_username(text)                                       to authenticated;
grant execute on function public.log_match_result(uuid, integer, integer)                       to authenticated;
grant execute on function public.request_order_drop(uuid, text)                                 to authenticated;
grant execute on function public.resolve_drop_request(uuid, boolean, text)                      to authenticated;
grant execute on function public.onboard_booster(text, text, jsonb, text, integer, integer, text, text) to authenticated;
grant execute on function public.set_order_credentials(uuid, text, text)                        to authenticated;
grant execute on function public.get_order_credentials(uuid)                                    to authenticated;
grant execute on function public.request_booster_role()                                         to authenticated;
grant execute on function public.set_duo_account_credentials(uuid, text, text)                  to authenticated;
grant execute on function public.get_duo_account_credentials(uuid)                              to authenticated;

-- ─── 13. SEED DATA ────────────────────────────────────────────────────────────

-- Games (only lol active)
insert into public.games (slug, name, is_active, sort_order) values
  ('lol', 'League of Legends', true,  1),
  ('valorant', 'Valorant',     false, 2),
  ('tft', 'Teamfight Tactics', false, 3);

-- Services (LoL only)
with lol as (select id from public.games where slug = 'lol')
insert into public.services (game_id, type, name, short_description, sort_order)
select lol.id, t.svc_type, t.svc_name, t.svc_desc, t.svc_ord
from lol, (values
  ('elo_boost'::public.service_type,         'Elo Boost',           'Suba do rank atual até o rank desejado',    1),
  ('win_boost'::public.service_type,         'Win Boost',           'Compre um número determinado de vitórias',  2),
  ('coaching'::public.service_type,          'Coaching',            'Coaching 1-on-1 com players de alto elo',   3),
  ('placement_matches'::public.service_type, 'Placement Matches',   'O melhor começo de temporada possível',     4)
) as t(svc_type, svc_name, svc_desc, svc_ord);

-- Service extras (final state after all product decisions: Duo Boost is now
-- a boost_mode checkbox on the order itself, not a paid extra; Solo Queue
-- Only, Live Monitoring and Appear Offline were discontinued)
insert into public.service_extras (name, description, price_modifier, price_modifier_pct, sort_order, icon, is_active)
values
  ('Apenas Solo',
   'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.',
   0, 20, 1, 'user', true),
  ('Processamento Prioritário',
   'Atribuição imediata ao booster mais bem avaliado. Seu pedido vai direto para frente da fila.',
   0, 15, 2, 'zap', true),
  ('Campeão Único',
   'Seu campeão favorito em cada partida. Especifique nas observações do pedido.',
   0, 10, 3, 'crosshair', true),
  ('Transmissão ao Vivo',
   'Assista seu booster jogar em tempo real via link de stream privado.',
   0, 10, 4, 'tv', true);
