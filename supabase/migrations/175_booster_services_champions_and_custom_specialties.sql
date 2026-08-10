-- 175_booster_services_champions_and_custom_specialties.sql
-- Aba Serviços do booster: (1) especialidades deixam de ser restritas à
-- lista fixa (booster_services_specialties_valid, migration 107) -- o
-- booster agora pode adicionar especialidades próprias em texto livre,
-- então o check de enum vira só um teto de quantidade (5); (2) novo campo
-- "campeões" (texto livre, até 3), sem taxonomia fixa por não existir uma
-- lista de campeões mantida no banco.

alter table public.booster_services
  add column if not exists champions text[];

alter table public.booster_services
  drop constraint if exists booster_services_specialties_valid,
  add constraint booster_services_specialties_valid check (
    specialties is not null
    and array_length(specialties, 1) between 1 and 5
    and not (specialties && array['']::text[])
  );

alter table public.booster_services
  drop constraint if exists booster_services_champions_valid,
  add constraint booster_services_champions_valid check (
    champions is null
    or (array_length(champions, 1) between 1 and 3 and not (champions && array['']::text[]))
  );
