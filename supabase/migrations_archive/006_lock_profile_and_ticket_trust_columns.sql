-- ─────────────────────────────────────────────────────────────────────────────
-- Checkup geral de segurança: duas policies de UPDATE protegiam a linha só
-- por posse (customer_id/id = auth.uid()), sem travar quais COLUNAS um
-- usuário não-admin pode alterar. Nenhuma tela hoje explora isso (a UI só
-- grava campos legítimos), mas um request forjado direto contra a API do
-- Supabase conseguiria hoje:
--   - profiles: mudar username (contornando a checagem de unicidade que só
--     existe na RPC update_my_username), email, discord_id;
--   - support_tickets: um cliente mudar status/priority/assigned_to/
--     resolved_at do próprio ticket, sem passar pelo fluxo de admin.
--
-- Mesmo padrão já usado em booster_profiles/customer_profiles
-- (trg_fn_guard_*_trust_columns): reverte silenciosamente as colunas
-- protegidas para o valor antigo quando quem executa é 'authenticated' e
-- não é admin. RPCs SECURITY DEFINER (ex.: update_my_username,
-- assign_ticket) continuam funcionando normalmente — elas rodam como o dono
-- da função, não como 'authenticated', então o guard não se aplica a elas.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.trg_fn_guard_profiles_trust_columns()
returns trigger language plpgsql set search_path = public as $$
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

drop trigger if exists trg_guard_profiles_trust_columns on public.profiles;
create trigger trg_guard_profiles_trust_columns
  before update on public.profiles
  for each row execute function public.trg_fn_guard_profiles_trust_columns();

create or replace function public.trg_fn_guard_support_tickets_trust_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status       := old.status;
    new.priority     := old.priority;
    new.assigned_to  := old.assigned_to;
    new.resolved_at  := old.resolved_at;
    new.customer_id  := old.customer_id;
    new.order_id     := old.order_id;
    new.created_at   := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_support_tickets_trust_columns on public.support_tickets;
create trigger trg_guard_support_tickets_trust_columns
  before update on public.support_tickets
  for each row execute function public.trg_fn_guard_support_tickets_trust_columns();
