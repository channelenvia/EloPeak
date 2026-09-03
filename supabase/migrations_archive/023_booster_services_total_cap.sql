-- ─────────────────────────────────────────────────────────────────────────────
-- trg_fn_cap_coach_packages (migration 012) only counted service_type =
-- 'coaching' rows toward the cap of 3 — safe when booster_services was
-- coach-only, but migration 022 generalized the table (and its UI,
-- BoosterServicesList.tsx) to accept any service_type ('coaching' /
-- 'boost_package' / 'other'). Since then, the client-side cap
-- (services.length < MAX_SERVICES, counting all types together) is the
-- ONLY thing enforcing "max 3 total" — a booster calling the API directly
-- (bypassing the app UI) could insert unlimited non-coaching rows, since
-- the trigger never counted them. This migration makes the trigger count
-- every row for the booster, regardless of type, closing that gap.
--
-- Non-destructive: this only changes what a future INSERT is checked
-- against — it does not touch any existing row, even a booster who already
-- has more than 3 rows today keeps them; they just can't add a 4th.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.trg_fn_cap_coach_packages()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id;
  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.trg_fn_cap_coach_packages() is
  'Caps booster_services at 3 rows per booster, TOTAL across every service_type '
  '(coaching/boost_package/other) — not scoped to coaching alone since '
  'migration 022 generalized the table. Name kept for compatibility with '
  'migration 012''s trigger binding; behavior is no longer coaching-specific.';

comment on table public.booster_services is
  'Ofertas de serviço do booster (até 3 no total, entre qualquer tipo — ver '
  'trigger trg_fn_cap_coach_packages, migration 023) — apesar do nome legado, '
  'service_type não é mais exclusivamente ''coaching''; a UI '
  '(BoosterServicesList.tsx) permite qualquer tipo de serviço.';
