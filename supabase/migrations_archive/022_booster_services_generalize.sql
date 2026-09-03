-- ─────────────────────────────────────────────────────────────────────────────
-- booster_profiles.can_coach was a decorative flag: set by boosters believing
-- it made them "a coach," but read by no query anywhere (CoachPackagePicker
-- and BoosterServicesList both key off booster_services rows directly, never
-- can_coach). The UI no longer exposes it for editing (removed from
-- BoosterProfessionalProfileForm.tsx and BoosterApplicationForm.tsx's
-- submit path is unaffected — the column itself is left in place,
-- unused, per the additive-only migration policy).
--
-- booster_services was originally coach-package-only (see migration 012),
-- but the table is a generic "my services" row (title/description/tempo/
-- price/lanes/specialties) capped at 3 per booster — nothing about its
-- schema or the cap trigger (trg_fn_cap_coach_packages, which only counts
-- service_type = 'coaching' rows) requires service_type to stay
-- 'coaching'-only. The booster-facing UI (BoosterServicesList.tsx) now lets
-- a booster pick any service_type ('coaching' / 'boost_package' / 'other')
-- when creating a service.
-- ─────────────────────────────────────────────────────────────────────────────

comment on column public.booster_profiles.can_coach is
  'Legado — não lido por nenhuma query. Elegibilidade para aparecer como coach '
  'vem de existir uma linha ativa em booster_services com service_type = ''coaching'' '
  '(ver CoachPackagePicker.tsx). Mantido só para não quebrar linhas existentes; '
  'não editável pela UI desde 2026-07-14.';

comment on table public.booster_services is
  'Ofertas de serviço do booster (até 3, ver trigger trg_fn_cap_coach_packages) — '
  'apesar do nome e do trigger legado, service_type não é mais exclusivamente '
  '''coaching''; a UI (BoosterServicesList.tsx) permite qualquer tipo de serviço.';
