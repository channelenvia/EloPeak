-- Disponibilidade real de boosters (presença).
--
-- Causa raiz: booster_profiles.is_available tem default false e nada no app
-- atualizava a coluna — todo booster aparecia como "Indisponível" no site
-- público mesmo estando logado. Agora:
--   1. booster_heartbeat(): o painel do booster envia um heartbeat periódico
--      que atualiza last_active_at (mesma coluna já usada pelos triggers de
--      aceite/mensagem).
--   2. public_booster_profiles.is_available passa a ser derivado de
--      last_active_at (janela de 5 minutos) — fonte única de verdade no banco.
-- A coluna crua booster_profiles.is_available fica preservada por
-- compatibilidade, mas deixa de ser lida pelo site.

create or replace function public.booster_heartbeat()
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.booster_profiles
     set last_active_at = now()
   where user_id = auth.uid()
     and status = 'approved';
$$;

revoke all on function public.booster_heartbeat() from public;
revoke all on function public.booster_heartbeat() from anon;
grant execute on function public.booster_heartbeat() to authenticated;

-- Mesmas colunas, mesma ordem — só is_available muda de origem.
-- Janela de 5 min deve permanecer igual a isBoosterOnline() em src/lib/utils.ts.
create or replace view public.public_booster_profiles with (security_barrier = true) as
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
    (bp.last_active_at is not null
      and bp.last_active_at > (now() - interval '5 minutes')) as is_available,
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
