-- available_boost_orders nunca expunha service_type no SELECT, só usava a
-- coluna no WHERE (public.orders.service_type, tabela base) -- o client
-- sempre recebia job.service_type undefined pra TODO pedido disponível.
-- getServiceLabel()/getOrderModeType() (src/lib/utils.ts) caem no fallback
-- '—' quando service_type é falsy, daí os dois travessões ao lado do código
-- do pedido na aba Jobs do booster (nenhum badge de tipo/modo nunca
-- renderizava o texto real). Mesma definição da migration 128, só
-- adicionando service_type à lista de colunas -- no FINAL da lista, não no
-- meio: CREATE OR REPLACE VIEW não permite mudar a posição das colunas já
-- existentes (só apêndice), então inserir no meio quebra com "cannot change
-- name of view column".

create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type
from public.orders
where status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
  and (
    not public.order_requires_access_token(service_type, boost_mode)
    or credentials_set = true
  )
  and (
    preferred_booster_id is null
    or exclusive_until is null
    or exclusive_until <= now()
    or preferred_booster_id = auth.uid()
  )
  and not exists (
    select 1 from public.order_drop_requests dr
    where dr.order_id = orders.id and dr.booster_id = auth.uid() and dr.status = 'approved'
  )
  and not exists (
    select 1 from public.booster_profiles bp
    where bp.user_id = auth.uid() and bp.blocked_until is not null and bp.blocked_until > now()
  );

revoke all on public.available_boost_orders from public, anon;
grant select on public.available_boost_orders to authenticated, service_role;
