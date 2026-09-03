-- Top3 deixa de recalcular a cada pedido concluído (trg_order_completed_
-- refresh_top3, migration 059) e passa a rodar só de 15 em 15 dias, nos
-- dias 15 e 30 de cada mês (via pg_cron, já habilitado -- migration 001).
-- O critério de ranking também muda de "concluídos no mês corrente" pra
-- "concluídos nos últimos 15 dias", pra bater com a janela real entre duas
-- rotações -- calendário corrido, então fevereiro (sem dia 30) só roda uma
-- vez naquele mês, o que é aceitável pro critério pedido (dias 15 e 30 fixos).

create or replace function public.refresh_top3_boosters()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_top3_ids uuid[];
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  select array_agg(sub.user_id) into v_top3_ids
  from (
    select bp.user_id
    from   public.booster_profiles bp
    join   public.orders o on o.assigned_booster_id = bp.user_id
    where  o.status = 'completed'
      and  o.completed_at >= now() - interval '15 days'
    group  by bp.user_id
    order  by count(*) desc
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;

comment on function public.refresh_top3_boosters is
  'Recalcula os 3 boosters com mais pedidos concluídos nos últimos 15 dias e '
  'marca is_top3. Chamada só pelo cron job refresh-top3-boosters (dias 15 e '
  '30 de cada mês) -- não mais a cada pedido concluído.';

drop trigger if exists order_completed_refresh_top3 on public.orders;
drop function if exists public.trg_order_completed_refresh_top3();

do $$
begin
  perform cron.unschedule('refresh-top3-boosters');
exception when others then
  null; -- job ainda não existia, primeira aplicação desta migration
end $$;

do $$
begin
  perform cron.schedule('refresh-top3-boosters', '0 3 15,30 * *', $cron$select public.refresh_top3_boosters()$cron$);
exception when undefined_function or insufficient_privilege then
  raise notice 'pg_cron indisponível -- agende refresh_top3_boosters() manualmente pros dias 15 e 30 de cada mês';
end $$;
