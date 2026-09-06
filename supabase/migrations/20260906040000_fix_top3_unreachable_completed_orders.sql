-- Bug: refresh_top3_boosters nunca promove ninguém a Top3 na prática.
--
-- O filtro `bps.completed_orders >= 10` (e o desempate
-- `order by ... bps.completed_orders desc`) lê uma coluna de
-- booster_performance_segments que NENHUMA função do banco escreve:
-- refresh_booster_performance_segments (migration 054/140) monta o INSERT
-- com uma lista explícita de colunas e `completed_orders` não está nela, então
-- toda linha fica com o valor padrão da coluna (0). Resultado:
-- `bps.completed_orders >= 10` é sempre falso pra todo mundo, a subquery do
-- ranking sempre retorna 0 linhas, e o cron (dias 15/30, ver
-- discord-top3-announcement) nunca encontra ninguém pra marcar is_top3 = true
-- -- o "Top3" fica permanentemente vazio mesmo com boosters aprovados e com
-- pedidos concluídos de sobra.
--
-- Fix: trocar a fonte do critério de volume por
-- booster_profiles.total_completed, que é a contagem real de pedidos
-- concluídos por booster, mantida corretamente por
-- trg_fn_order_completed_booster_stats a cada order completado. Critério de
-- qualidade (performance_score, migration 127) e o piso de 10 pedidos
-- concluídos continuam os mesmos -- só a coluna morta é substituída pela que
-- de fato é atualizada.
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

  select array_agg(sub.booster_id) into v_top3_ids
  from (
    select bps.booster_id
    from   public.booster_performance_segments bps
    join   public.booster_profiles bp on bp.user_id = bps.booster_id
    where  bps.service_type = '__all__'
      and  bps.rank_bucket = '__all__'
      and  bps.account_type = '__all__'
      and  bps.queue_type = '__all__'
      and  bp.status = 'approved'
      and  bp.total_completed >= 10
    order  by bps.performance_score desc, bp.total_completed desc, bps.booster_id
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;

comment on function public.refresh_top3_boosters is
  'Recalcula os 3 boosters com maior performance_score (booster_performance_'
  'segments, linha rollup __all__/__all__/__all__/__all__, migration 054) '
  'entre os aprovados com >= 10 pedidos concluídos (booster_profiles.'
  'total_completed) e marca is_top3. Chamada só pelo cron job '
  'discord-top3-announcement (dias 15 e 30 de cada mês). Antes desta migration '
  'o piso de 10 pedidos era checado contra booster_performance_segments.'
  'completed_orders, coluna nunca escrita por refresh_booster_performance_'
  'segments -- ficava sempre em 0 e ninguém nunca virava Top3.';
