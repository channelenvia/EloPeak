-- Top3 deixa de ser por volume bruto de pedidos concluídos (quem "jogou
-- mais" nos últimos 15 dias) e passa a usar o mesmo sistema de pontuação já
-- existente (booster_performance_segments.performance_score, migration 054:
-- 45% winrate ajustado por Wilson + 30% KDA normalizado + 25% nota do
-- cliente ajustada bayesianamente) -- ou seja, nota + estatística real
-- comparada entre os boosters, não só quantidade de pedidos.
--
-- Usa a linha "rollup" global de cada booster (service_type='__all__' e
-- rank_bucket='__all__', já calculada por refresh_booster_performance_segments)
-- em vez da melhor pontuação por segmento -- assim um booster forte só numa
-- faixa/serviço estreito não passa na frente de quem é consistente no geral.
--
-- O agendamento (pg_cron, dias 15 e 30, 3h) e o "reset geral antes de marcar
-- os 3 novos" continuam iguais -- só o critério de seleção muda.
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
      and  bp.status = 'approved'
      and  bps.total_matches > 0
    order  by bps.performance_score desc, bps.total_matches desc, bps.booster_id
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
  'segments, linha rollup __all__/__all__, migration 054) entre os aprovados '
  'e marca is_top3. Chamada só pelo cron job refresh-top3-boosters (dias 15 '
  'e 30 de cada mês) -- critério de qualidade, não mais volume de pedidos.';

-- toggle_booster_top3 (override manual do admin) não faz mais sentido: o
-- valor sempre seria sobrescrito no próximo refresh automático (dias 15/30),
-- e nenhum ponto do frontend chama mais essa RPC.
drop function if exists public.toggle_booster_top3(uuid, boolean);
