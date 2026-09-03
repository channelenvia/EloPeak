-- ─────────────────────────────────────────────────────────────────────────────
-- The generic "Serviços" tab (booster_services) becomes coach-specific:
-- boosters create up to 3 coaching packages with a lane focus (max 2) and a
-- fixed specialty vocabulary, instead of the old free-text
-- requirements/availability_note/rules. Those three columns are left in
-- place (not dropped) — the new UI simply stops writing to them.
--
-- orders.booster_service_id records which specific package was purchased —
-- the order still goes through the exact same exclusive-booster mechanism
-- as a direct profile order (preferred_booster_id/exclusive_until, migrations
-- 008-010), just with the booster derived from the chosen package instead of
-- a bare ?booster= link.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.booster_services add column if not exists lanes text[];
alter table public.booster_services add column if not exists specialties text[];

alter table public.booster_services
  add constraint booster_services_lanes_valid check (
    lanes is null
    or (array_length(lanes, 1) <= 2 and lanes <@ array['top','jungle','mid','bot','support'])
  ) not valid;

alter table public.booster_services
  add constraint booster_services_specialties_valid check (
    specialties is null
    or specialties <@ array[
      'macro','micro','wave_control','invades','vision','trades',
      'teamfighting','laning_phase','objectives','itemization','matchups','mindset'
    ]
  ) not valid;

-- Client already capped at 5 generic services with no DB enforcement at all
-- (see BoosterServicesList.tsx MAX_SERVICES) — this is the first server-side
-- cap, scoped to service_type='coaching' so it never touches any
-- pre-existing non-coaching row from before this change.
create or replace function public.trg_fn_cap_coach_packages()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if new.service_type = 'coaching' then
    select count(*) into v_count
    from public.booster_services
    where booster_id = new.booster_id and service_type = 'coaching';
    if v_count >= 3 then
      raise exception 'coach_package_limit_reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cap_coach_packages on public.booster_services;
create trigger trg_cap_coach_packages
  before insert on public.booster_services
  for each row execute function public.trg_fn_cap_coach_packages();

alter table public.orders add column if not exists booster_service_id uuid references public.booster_services(id);
