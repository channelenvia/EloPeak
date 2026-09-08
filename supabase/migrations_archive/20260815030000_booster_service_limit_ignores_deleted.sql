-- O limite de três ofertas deve contar somente serviços atuais. Registros
-- arquivados permanecem no banco para preservar pedidos históricos, mas não
-- podem impedir o booster de cadastrar um novo serviço.

create or replace function public.trg_fn_cap_coach_packages()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id
    and deleted_at is null;

  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.trg_fn_cap_coach_packages() is
  'Limita cada booster a três serviços não arquivados; linhas com deleted_at preenchido preservam o histórico sem consumir uma vaga.';
