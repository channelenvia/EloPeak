-- Rotas (lanes) escolhidas pelo cliente no configurador de Elo Boost, Vitórias
-- (win_boost/md5) e Clash. Semântica depende de boost_mode (ver
-- src/features/customer/order-builder/StepConfigure.tsx e
-- ClashConfigPicker.tsx, mesma regra nos dois):
--   solo -> rota(s) que o cliente PEDE que o booster jogue (só o booster
--           joga a conta nesse modo, então a escolha vai direto pra ele).
--   duo  -> rota(s) que o cliente vai jogar ELE MESMO (joga junto do booster
--           na duo queue); as 5 lanes menos essas ficam disponíveis pro
--           booster, computado no frontend (getAvailableLanes em
--           src/lib/lolTaxonomy.ts), não armazenado.
-- Mesmo vocabulário e mesma regra "no máximo 2, subconjunto das 5 lanes" já
-- usada em booster_services.lanes (migration 160) -- CHECK aqui em vez de
-- validação em função porque orders só recebe esse campo uma vez, na
-- inserção via create-pix-payment (nunca editado por uma RPC dedicada).
alter table public.orders
  add column customer_lanes text[];

alter table public.orders
  add constraint orders_customer_lanes_valid check (
    customer_lanes is null
    or (
      array_length(customer_lanes, 1) <= 2
      and customer_lanes <@ array['top', 'jungle', 'mid', 'bot', 'support']
      -- Sem duplicata: ['top','top'] passaria no <@ acima mas só reservaria
      -- 1 lane de fato (getAvailableLanes remove 'top' uma vez só), mesmo
      -- "gastando" as 2 vagas -- mesma defesa que o zod (orderPricing.ts)
      -- já aplica no lado da API, replicada aqui pra qualquer outro caminho
      -- de escrita.
      and cardinality(customer_lanes) = cardinality(array(select distinct unnest(customer_lanes)))
    )
  );

-- public.orders usa um allow-list explícito de colunas pro grant select de
-- `authenticated` (migration 036, reforçado nas migrations 112/150) -- sem
-- isto, customer_lanes existiria na tabela mas nenhum select(ORDER_SAFE_COLUMNS)
-- (que já inclui essa coluna, ver src/lib/orderColumns.ts) conseguiria rodar
-- pra NENHUM authenticated -- falharia com "permission denied for table
-- orders" por inteiro, não só a coluna vindo undefined (mesmo erro descrito
-- na migration 150, cometido de novo aqui até esta correção).
grant select (customer_lanes)
  on public.orders to authenticated;

-- Apêndice no final da lista de colunas -- CREATE OR REPLACE VIEW não permite
-- inserir no meio (mesma razão das migrations 163/164). Exposto cru (não
-- computado) porque não é dado sensível como riot_id: o booster decide o que
-- mostrar (pedido direto em solo, complemento em duo) inteiramente no
-- frontend via getAvailableLanes.
create or replace view public.available_boost_orders
  with (security_barrier = true) as
select
  id, service_id, game_id, status, queue_type, boost_mode, server,
  current_rank, target_rank, wins_purchased, sessions_purchased, win_package,
  extras, total_price, estimated_hours, wins_played, losses_played,
  current_pdl, pdl_bracket, avg_pdl_gain, avg_pdl_loss, pricing_version,
  created_at, updated_at, preferred_booster_id, exclusive_until,
  drop_count, rank_before_last_drop, last_dropped_at, service_type,
  clash_tier, clash_day, customer_lanes
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
