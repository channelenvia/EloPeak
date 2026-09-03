-- Achado da auditoria: booster_profiles_update_own_or_admin (migration
-- 013_role_application_rls_hardening.sql) permite que o próprio booster
-- faça UPDATE em QUALQUER coluna da própria linha -- só `status` tem
-- trigger travando (002_lock_booster_status_column.sql). Nenhuma trava
-- protege is_top3, total_earnings, rating, rating_count, blocked_until,
-- suspended_until, verified_at, total_completed. is_top3 decide o split de
-- comissão (60% vs 55%, usado em apply_order_drop) -- um booster autenticado
-- podia hoje chamar supabase.from('booster_profiles').update({is_top3: true,
-- total_earnings: 999999, blocked_until: null, ...}).eq('user_id', meuId)
-- direto via PostgREST, sem precisar da UI nem de nenhuma RPC.
--
-- Fix: mesmo padrão do trigger de status -- bloqueia mudança não-admin
-- nessas colunas especificamente (blocklist, não allowlist completa: o
-- histórico de migrations deste projeto já tem drift confirmado -- colunas
-- como suspended_until nem aparecem em nenhuma migration tracked, então uma
-- allowlist completa arriscaria quebrar algum fluxo legítimo que não está
-- capturado aqui. Blocklist das colunas financeiras/privilegiadas
-- confirmadas é o fix seguro disponível sem acesso ao schema ao vivo).

create or replace function public.prevent_non_admin_booster_privileged_column_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
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

drop trigger if exists booster_profiles_lock_privileged_columns on public.booster_profiles;

create trigger booster_profiles_lock_privileged_columns
  before update on public.booster_profiles
  for each row execute function public.prevent_non_admin_booster_privileged_column_change();
