-- supabase/migrations/111_clash_service_and_fields.sql
-- Schema do serviço Clash: catálogo, tier/dia, e as duas integrações que
-- fazem Solo/Duo Clash funcionarem de graça com os sistemas existentes:
-- order_requires_access_token (credenciais protegidas, Solo) e
-- service_extras.flow (addons, ambas modalidades). A reserva de conta Duo
-- (reserve_duo_account) já funciona sem nenhuma mudança, pois só olha
-- orders.boost_mode = 'duo' -- Clash reaproveita essa coluna, não cria
-- clash_mode.

-- ── 1) Catálogo: uma linha de serviço pra Clash (Solo/Duo é modalidade via
-- boost_mode, igual elo_boost) ──────────────────────────────────────────────
insert into public.services (game_id, type, name, short_description, is_active, sort_order)
select g.id, 'clash'::public.service_type, 'Clash',
       'Clash em dupla ou solo, no dia que você escolher', true, 6
from public.games g where g.slug = 'lol'
on conflict (game_id, type) do nothing;

-- ── 2) Tier e dia ────────────────────────────────────────────────────────────
create type public.clash_tier as enum ('tier_4', 'tier_3', 'tier_2', 'tier_1');
create type public.clash_day as enum ('saturday', 'sunday');

alter table public.orders
  add column clash_tier public.clash_tier,
  add column clash_day public.clash_day;

alter table public.orders
  add constraint orders_clash_fields_check check (
    (service_type = 'clash' and clash_tier is not null and clash_day is not null)
    or (service_type <> 'clash' and clash_tier is null and clash_day is null)
  );

-- ── 3) current_rank: Clash não coleta rank+divisão específico, só o tier
-- (já gravado em clash_tier acima) -- relaxa a NOT NULL só pra esse serviço.
alter table public.orders alter column current_rank drop not null;
alter table public.orders
  add constraint orders_current_rank_required_check
  check (service_type = 'clash' or current_rank is not null);

-- ── 4) Credenciais protegidas: Solo Clash usa o mesmo fluxo de token
-- (set_order_credentials/get_order_credentials/resolve_order_access_token)
-- de solo elo_boost/win_boost/md5 -- só precisa entrar nesta função-gate.
-- Mudança aditiva: nenhum outro serviço muda de comportamento.
create or replace function public.order_requires_access_token(
  p_service_type public.service_type,
  p_boost_mode text
) returns boolean
language sql
immutable
set search_path = public as $$
  select
    (p_service_type = 'elo_boost' and coalesce(p_boost_mode, 'solo') = 'solo')
    or p_service_type in ('win_boost', 'md5')
    or (p_service_type = 'clash' and coalesce(p_boost_mode, 'solo') = 'solo')
$$;

-- ── 5) Addons: widen service_extras.flow pra aceitar os dois fluxos de
-- Clash. Nenhuma linha é inserida aqui -- CLASH_ADDON_CODES (shared/
-- clashDomain.ts) começa vazio, então nenhum addon fica selecionável até
-- alguém cadastrar uma linha aqui E adicionar o code na whitelist.
alter table public.service_extras
  drop constraint if exists service_extras_flow_check;
alter table public.service_extras
  add constraint service_extras_flow_check
  check (flow is null or flow in ('solo_standard', 'duo_standard', 'master_plus', 'clash_solo', 'clash_duo'));
