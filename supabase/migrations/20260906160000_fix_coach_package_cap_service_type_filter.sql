-- Bug (MEDIUM): trg_fn_cap_coach_packages conta todas as linhas não-deletadas
-- de booster_services do booster, independente de service_type, e capa em 3
-- -- mas o modelo de tabela/coluna já suporta múltiplos service_type.
-- Serviços customizados não-coaching consumiriam o mesmo limite que o nome
-- da trigger diz ser só de coaching.
--
-- Fix: filtrar a contagem por service_type = new.service_type (o limite de
-- 3 pacotes passa a ser por tipo de serviço, não um teto compartilhado entre
-- todos).
create or replace function public.trg_fn_cap_coach_packages()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id
    and service_type = new.service_type
    and deleted_at is null;

  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;
