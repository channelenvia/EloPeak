-- Booster lists (público, admin) e o seletor de contas Duo dentro do pedido
-- só tinham polling (15-30s), nunca push real -- usuário via a mudança só
-- depois de esperar o intervalo ou dar F5. booster_profiles e duo_accounts
-- não podem entrar direto em supabase_realtime como order_status_events fez
-- pra orders: as duas guardam colunas sensíveis que a publicação
-- transmitiria inteiras pra qualquer canal aberto -- cpf/email/full_name/
-- total_earnings em booster_profiles, encrypted_credentials/access_token_id
-- em duo_accounts. Mesmo padrão de order_status_events: uma tabela de evento
-- mínima (só o id relevante + timestamp), populada por trigger, nunca com o
-- payload sensível -- o cliente usa o evento só como sinal pra refazer a
-- consulta normal (que já respeita RLS/colunas certas via view/select
-- explícito), nunca lê dado direto do evento.
-- Sem FK pra booster_profiles/duo_accounts de propósito: são tabelas de
-- evento "fire and forget" (mesmo espírito de order_status_events), e um
-- AFTER DELETE em duo_accounts que tentasse inserir com FK pra
-- duo_accounts(id) falharia -- a linha referenciada já não existe mais no
-- momento em que o trigger AFTER DELETE roda.
create table if not exists public.booster_profile_events (
  id bigint generated always as identity primary key,
  booster_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.booster_profile_events enable row level security;
drop policy if exists booster_profile_events_read on public.booster_profile_events;
create policy booster_profile_events_read on public.booster_profile_events for select using (true);

create or replace function public.notify_booster_profile_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.booster_profile_events(booster_id) values (new.user_id);
  return new;
end;
$$;

drop trigger if exists trg_notify_booster_profile_changed on public.booster_profiles;
create trigger trg_notify_booster_profile_changed
after update of status, rating, rating_count, is_top3, current_rank, display_name, last_active_at, blocked_until, suspended_until
on public.booster_profiles
for each row execute function public.notify_booster_profile_changed();

create table if not exists public.duo_account_events (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.duo_account_events enable row level security;
drop policy if exists duo_account_events_read on public.duo_account_events;
create policy duo_account_events_read on public.duo_account_events for select using (true);

create or replace function public.notify_duo_account_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.duo_account_events(account_id) values (coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_notify_duo_account_changed on public.duo_accounts;
create trigger trg_notify_duo_account_changed
after insert or update or delete on public.duo_accounts
for each row execute function public.notify_duo_account_changed();

do $$
declare
  t text;
begin
  foreach t in array array['booster_profile_events', 'duo_account_events']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
