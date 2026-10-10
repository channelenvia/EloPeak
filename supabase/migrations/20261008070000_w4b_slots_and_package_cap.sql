-- M-11: pedido em drop_requested/under_review/disputed continua ocupando a vaga do booster.
-- M-05: teto de 3 pacotes sem corrida e sem burlar por soft delete/troca de service_type.
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.booster_active_slot_counts(p_booster_user_id uuid)
 RETURNS TABLE(solo_count integer, duo_count integer, total_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      count(*) filter (where boost_mode = 'solo')::integer,
      count(*) filter (where boost_mode = 'duo')::integer,
      count(*)::integer
    from public.orders
    where assigned_booster_id = p_booster_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'under_review', 'disputed')
      and not used_exclusive_slot
      and service_type <> 'coaching'
      and not reassigned_by_admin;
end;
$function$;

CREATE OR REPLACE FUNCTION public.booster_has_active_exclusive_slot(p_booster_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if auth.uid() is distinct from p_booster_user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return exists (
    select 1 from public.orders
    where assigned_booster_id = p_booster_user_id
      and status in ('assigned', 'in_progress', 'paused', 'awaiting_customer', 'drop_requested', 'under_review', 'disputed')
      and used_exclusive_slot
  );
end;
$function$;

create or replace function public.trg_fn_cap_coach_packages()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  -- Fila por booster: duas criacoes simultaneas nao passam juntas pelo teto de 3.
  perform pg_advisory_xact_lock(hashtextextended('booster_services:' || new.booster_id::text, 0));

  -- UPDATE so conta quando o pacote passa a ocupar uma vaga (reativar da lixeira ou trocar service_type).
  if tg_op = 'UPDATE' and (new.deleted_at is not null or (old.deleted_at is null and old.service_type = new.service_type)) then
    return new;
  end if;

  select count(*) into v_count
  from public.booster_services
  where booster_id = new.booster_id
    and service_type = new.service_type
    and deleted_at is null
    and id <> new.id;

  if v_count >= 3 then
    raise exception 'booster_service_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger trg_cap_coach_packages on public.booster_services;
create trigger trg_cap_coach_packages before insert or update of deleted_at, service_type on public.booster_services
  for each row execute function public.trg_fn_cap_coach_packages();
