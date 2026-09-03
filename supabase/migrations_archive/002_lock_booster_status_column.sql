-- ─────────────────────────────────────────────────────────────────────────────
-- Trava a coluna booster_profiles.status contra alteração direta por não-admins.
--
-- A policy "booster_profiles_update_own_or_admin" (001_initializing.sql) permite
-- que o próprio booster faça UPDATE na sua linha (using: user_id = auth.uid()),
-- mas não tem WITH CHECK — ao contrário do padrão já usado em "profiles_update_own",
-- que trava a coluna "role" via WITH CHECK. Sem essa trava, um booster autenticado
-- poderia rodar diretamente pelo client:
--   supabase.from('booster_profiles').update({ status: 'approved' }).eq('user_id', meuId)
-- e a RLS deixaria passar, já que a linha pertence a ele.
--
-- Esse trigger fecha essa lacuna: qualquer UPDATE que altere "status" só é aceito
-- se quem está executando for admin (public.is_admin()). Não afeta:
--  - o update legítimo do próprio form (can_coach/available_days, que não muda status);
--  - approve_booster()/toggle_booster_top5(), que rodam como security definer e
--    verificam is_admin() do chamador real antes de tocar na linha.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.prevent_non_admin_booster_status_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and new.status is distinct from old.status then
    raise exception 'only admins can change booster application status';
  end if;
  return new;
end;
$$;

drop trigger if exists booster_profiles_lock_status on public.booster_profiles;

create trigger booster_profiles_lock_status
  before update on public.booster_profiles
  for each row execute function public.prevent_non_admin_booster_status_change();
