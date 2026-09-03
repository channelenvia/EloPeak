-- ─────────────────────────────────────────────────────────────────────────────
-- 1) booster_services — novos campos para suportar tipos de serviço além de
--    coaching (categoria, unidade de cobrança, requisitos, disponibilidade,
--    ativo/inativo, regras). Mantidos como texto livre (sem enum rígido) para
--    não travar a plataforma a uma lista fixa de jogos/categorias.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.booster_services
  add column if not exists service_type      text,
  add column if not exists unit              text not null default 'fixed',
  add column if not exists requirements      text,
  add column if not exists availability_note text,
  add column if not exists is_active         boolean not null default true,
  add column if not exists rules             text,
  add column if not exists updated_at        timestamptz not null default now();

create index if not exists booster_services_active_idx on public.booster_services(is_active);

create or replace function public.update_booster_services_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_booster_services_updated_at on public.booster_services;

create trigger set_booster_services_updated_at
  before update on public.booster_services
  for each row execute function public.update_booster_services_updated_at();

-- Leitura pública deixa de mostrar serviços desativados pelo próprio booster.
drop policy if exists "booster_services_public_read" on public.booster_services;

create policy "booster_services_public_read" on public.booster_services
  for select
  using (
    is_active = true
    and exists (
      select 1 from public.booster_profiles bp
      where bp.user_id = booster_services.booster_id
        and bp.status = 'approved'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Agregação de rating/rating_count em booster_profiles a partir de reviews.
--    Essas colunas existem desde a baseline mas nada as populava — ficavam
--    sempre no valor default. O trigger roda como security definer porque
--    trg_fn_guard_booster_profile_trust_columns bloqueia update direto dessas
--    colunas por quem não é admin (mesmo padrão usado por approve_booster).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.refresh_booster_rating(p_booster_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
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

create or replace function public.trg_fn_reviews_refresh_booster_rating()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if old.booster_id is not null then
      perform public.refresh_booster_rating(old.booster_id);
    end if;
    return old;
  end if;

  if new.booster_id is not null then
    perform public.refresh_booster_rating(new.booster_id);
  end if;
  if TG_OP = 'UPDATE' and old.booster_id is not null and old.booster_id is distinct from new.booster_id then
    perform public.refresh_booster_rating(old.booster_id);
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_refresh_booster_rating on public.reviews;

create trigger reviews_refresh_booster_rating
  after insert or update or delete on public.reviews
  for each row execute function public.trg_fn_reviews_refresh_booster_rating();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) public_booster_profiles não expunha lanes/specialties, embora o frontend
--    público (BoosterPublicProfilePage) já tentasse ler essas colunas — os
--    badges de especialidade ficavam sempre vazios. Corrige a view.
-- ─────────────────────────────────────────────────────────────────────────────

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
  updated_at,
  lanes,
  specialties
from public.booster_profiles
where status = 'approved';
