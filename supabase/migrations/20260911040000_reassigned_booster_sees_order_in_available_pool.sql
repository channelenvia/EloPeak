-- Bug reportado: admin reatribui (admin_reassign_booster) um pedido de volta
-- pro MESMO booster que já o tinha dropado -- o RPC roda com sucesso
-- (preferred_booster_id = booster, reassigned_by_admin = true) e a migration
-- 20260911000000 já corrigiu accept_boost_order pra aceitar essa reaceitação,
-- mas o pedido nunca chega a aparecer na aba Jobs do booster pra ele clicar
-- "Aceitar" -- porque available_boost_orders (a view que alimenta
-- listAvailableJobs/getBoosterOrder) tem o MESMO guard anti-abuso
-- (not exists ... order_drop_requests ... status='approved') só que
-- incondicional, sem a mesma exceção pra quando é o próprio admin
-- reservando o pedido de volta via preferred_booster_id.
--
-- Fix: mesma lógica de 20260911000000 -- ignora o guard quando
-- preferred_booster_id já é este booster (reserva explícita do admin).
--
-- create or replace view falhou (42P16 "cannot drop columns from view"):
-- o backup local de migrations_archive/ não tem TODAS as migrations já
-- aplicadas no banco real -- a versão vigente da view já tinha colunas
-- (booster_service_id, reassigned_by_admin, riot_id, pelo menos) que nunca
-- entraram em nenhum arquivo local de "create or replace view
-- available_boost_orders". Por isso troca pra drop + create (não trava no
-- conjunto de colunas anterior) com uma lista reconstruída a partir de todo
-- campo que o front realmente lê de um job ainda não aceito (AvailableJobs.
-- tsx, JobDetail.tsx, OrderCardDetails.tsx, exclusiveJobBadges.ts) em vez de
-- só copiar o texto da última migration local encontrada.
drop view if exists public.available_boost_orders;

create view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type,
  clash_tier, clash_day, customer_lanes,
  -- Reconstruídas (não estavam na última "create or replace view" local,
  -- ver nota acima) -- todas já lidas pelo front num job ainda no pool:
  booster_service_id, reassigned_by_admin, riot_id,
  assigned_booster_id, match_sync_started_at
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    case
      when service_type = 'coaching' then preferred_booster_id = auth.uid()
      else preferred_booster_id is null
        or exclusive_until is null
        or exclusive_until <= now()
        or preferred_booster_id = auth.uid()
    end
  )
  and (
    preferred_booster_id = auth.uid()
    or not exists (
      select 1 from public.order_drop_requests dr
      where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
    )
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
