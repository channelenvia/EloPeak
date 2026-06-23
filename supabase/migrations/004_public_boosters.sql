-- ============================================================
-- Migration 004 — Página pública de boosters
-- ============================================================

-- ─── 1. Novos campos em booster_profiles ─────────────────────────────────────

alter table public.booster_profiles
  add column if not exists rank_stats      jsonb,
  add column if not exists last_active_at  timestamptz;

-- Inicializa last_active_at com a data de criação do perfil
update public.booster_profiles
  set last_active_at = created_at
  where last_active_at is null;

-- ─── 2. View pública segura de boosters aprovados ───────────────────────────
--
-- NÃO adicionamos uma RLS policy ampla no booster_profiles porque isso
-- exporia colunas com PII (email, cpf, full_name, total_earnings) ao papel anon.
-- Em vez disso, criamos uma view com security_barrier que seleciona apenas as
-- colunas seguras e filtra por status='approved'.
-- A view é owned pelo postgres (superuser), portanto executa com seus
-- privilégios (SECURITY DEFINER por padrão para views no Supabase), mas o
-- security_barrier garante que o WHERE status='approved' é aplicado antes
-- de qualquer condição do chamador — sem risk de infer-via-filter attack.

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

-- Concede SELECT na view para papéis públicos.
-- O table base não recebe nenhuma policy ampla adicional.
grant select on public.public_booster_profiles to anon, authenticated;

-- ─── 3. Triggers para manter last_active_at atualizado ───────────────────────

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

drop trigger if exists trg_booster_active_on_message on public.order_messages;
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

drop trigger if exists trg_booster_active_on_accept on public.orders;
create trigger trg_booster_active_on_accept
  after update of assigned_booster_id on public.orders
  for each row execute function public.trg_fn_booster_active_on_accept();
