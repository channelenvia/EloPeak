-- Remove o conceito de booster "disponível/indisponível".
--
-- Causa raiz: booster_profiles.is_available nunca foi escrito pelo app (nem
-- heartbeat, nem nenhum outro fluxo) — ficou sempre no default `false`, e o
-- índice parcial booster_profiles_available_idx nunca indexou uma linha
-- true. A view public_booster_profiles nem sequer selecionava essa coluna:
-- ela computava seu próprio "is_available" a partir de last_active_at
-- (migration 043). A seleção de boosters (Top 5/Top 3, jobs, pedidos diretos)
-- nunca leu nenhuma das duas colunas — não há dependência funcional real.
--
-- O produto não deve mais expor disponibilidade manual nem automática como
-- badge binário. O frontend passa a mostrar apenas "visto por último"
-- (last_active_at, via formatLastSeen()) em vez de Disponível/Indisponível.
--
-- 1. Derruba o índice parcial órfão.
-- 2. Recria a view sem a coluna computada is_available.
-- 3. Remove a coluna crua booster_profiles.is_available (nunca escrita).

drop index if exists public.booster_profiles_available_idx;

-- CREATE OR REPLACE VIEW cannot drop a column from the projection — the view
-- must be dropped and recreated with the same grants.
drop view if exists public.public_booster_profiles;

create view public.public_booster_profiles with (security_barrier = true) as
 select bp.id,
    bp.user_id,
    bp.display_name,
    bp.bio,
    bp.current_rank,
    bp.peak_rank,
    bp.games,
    bp.rating,
    bp.rating_count,
    bp.total_completed,
    bp.is_top5,
    bp.rank_stats,
    bp.last_active_at,
    bp.updated_at,
    bp.lanes,
    bp.specialties,
    p.avatar_url
   from public.booster_profiles bp
     join public.profiles p on p.id = bp.user_id
  where bp.status = 'approved';

grant all on table public.public_booster_profiles to anon;
grant all on table public.public_booster_profiles to authenticated;
grant all on table public.public_booster_profiles to service_role;

alter table public.booster_profiles drop column if exists is_available;
