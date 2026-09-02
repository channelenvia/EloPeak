-- Bug reportado ao reatribuir booster no admin: "column reference status is
-- ambiguous". admin_list_boosters_with_slots() (usada pelo modal "Reatribuir
-- booster" pra listar boosters elegíveis, via useBoostersWithSlots) declara
-- `status` como coluna de retorno (RETURNS TABLE(..., status booster_status,
-- ...)). Dentro do LEFT JOIN LATERAL que conta os pedidos ativos de cada
-- booster, a subquery referenciava `status`/`boost_mode` sem qualificar a
-- tabela -- o Postgres não conseguia decidir entre a coluna de retorno
-- `status` e orders.status.
--
-- Fix: dá um alias (ord) pra orders dentro do lateral join e qualifica as
-- referências, igual já é feito pro resto da função (bp.*). Sem mudança de
-- assinatura ou comportamento.
create or replace function public.admin_list_boosters_with_slots()
returns table(
  id uuid,
  user_id uuid,
  display_name text,
  status public.booster_status,
  is_top3 boolean,
  solo_count integer,
  duo_count integer,
  total_count integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      bp.id,
      bp.user_id,
      bp.display_name,
      bp.status,
      bp.is_top3,
      coalesce(o.solo_count, 0)::integer,
      coalesce(o.duo_count, 0)::integer,
      coalesce(o.total_count, 0)::integer
    from public.booster_profiles bp
    left join lateral (
      select
        count(*) filter (where ord.boost_mode = 'solo') as solo_count,
        count(*) filter (where ord.boost_mode = 'duo')   as duo_count,
        count(*)                                          as total_count
      from public.orders ord
      where ord.assigned_booster_id = bp.user_id
        and ord.status in ('assigned', 'in_progress', 'paused', 'awaiting_customer')
    ) o on true
    order by bp.display_name asc;
end;
$$;
