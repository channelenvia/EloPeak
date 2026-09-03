-- Espelho de WIN_PRICE_CENTS (shared/pricing.ts) no Postgres -- necessário
-- porque as novas fórmulas de drop/reatribuição (migrations seguintes)
-- rodam inteiramente em PL/pgSQL e precisam do "valor de 1 win no elo
-- atual" (usado sobretudo no Boost Mestre+ com drop negativo), mas o
-- Postgres não tem acesso a shared/pricing.ts. Mesma decisão de produto já
-- tomada pra master_plus_pricing (migration 028) -- fonte de verdade
-- duplicada de propósito, protegida por um teste (shared/
-- winPriceCentsSeed.test.ts) que compara linha a linha contra WIN_PRICE_CENTS,
-- igual o teste que já existe pra master_plus_pricing
-- (shared/boostConfigSeed.test.ts). Atualize os dois lados juntos.
--
-- solo_duo e flex têm exatamente os mesmos valores em WIN_PRICE_CENTS hoje
-- (duplicados de propósito na fonte, não uma coincidência) -- espelhados
-- aqui por queue mesmo assim, pra nunca divergir silenciosamente se um dia
-- passarem a ter preços diferentes.

create table public.win_price_cents_catalog (
  queue_type  public.queue_type not null,
  boost_mode  text not null check (boost_mode in ('solo', 'duo')),
  tier        text not null,
  price_cents integer not null check (price_cents >= 0),
  primary key (queue_type, boost_mode, tier)
);

comment on table public.win_price_cents_catalog is
  'Espelho de WIN_PRICE_CENTS (shared/pricing.ts) -- valor de 1 Vitória Avulsa por fila/modo/tier, em centavos. Usado pelas fórmulas de drop/reatribuição do Mestre+. Sincronizado por shared/winPriceCentsSeed.test.ts.';

alter table public.win_price_cents_catalog enable row level security;

-- Leitura pública -- mesmo padrão de master_plus_pricing/games/services,
-- não é dado sensível.
create policy "win_price_cents_catalog_read" on public.win_price_cents_catalog
  for select using (true);

grant select on public.win_price_cents_catalog to anon, authenticated;

insert into public.win_price_cents_catalog (queue_type, boost_mode, tier, price_cents) values
  ('solo_duo', 'solo', 'iron',       458),
  ('solo_duo', 'solo', 'bronze',     458),
  ('solo_duo', 'solo', 'silver',     479),
  ('solo_duo', 'solo', 'gold',       567),
  ('solo_duo', 'solo', 'platinum',   930),
  ('solo_duo', 'solo', 'emerald',   1315),
  ('solo_duo', 'solo', 'diamond',   1685),
  ('solo_duo', 'solo', 'master',    5830),
  ('solo_duo', 'solo', 'grandmaster', 8620),
  ('solo_duo', 'solo', 'challenger', 14440),
  ('solo_duo', 'duo',  'iron',       605),
  ('solo_duo', 'duo',  'bronze',     605),
  ('solo_duo', 'duo',  'silver',     795),
  ('solo_duo', 'duo',  'gold',       929),
  ('solo_duo', 'duo',  'platinum',  1085),
  ('solo_duo', 'duo',  'emerald',   2005),
  ('solo_duo', 'duo',  'diamond',   2995),
  ('solo_duo', 'duo',  'master',    8515),
  ('solo_duo', 'duo',  'grandmaster', 12590),
  ('solo_duo', 'duo',  'challenger', 21090),
  ('flex',     'solo', 'iron',       458),
  ('flex',     'solo', 'bronze',     458),
  ('flex',     'solo', 'silver',     479),
  ('flex',     'solo', 'gold',       567),
  ('flex',     'solo', 'platinum',   930),
  ('flex',     'solo', 'emerald',   1315),
  ('flex',     'solo', 'diamond',   1685),
  ('flex',     'solo', 'master',    5830),
  ('flex',     'solo', 'grandmaster', 8620),
  ('flex',     'solo', 'challenger', 14440),
  ('flex',     'duo',  'iron',       605),
  ('flex',     'duo',  'bronze',     605),
  ('flex',     'duo',  'silver',     795),
  ('flex',     'duo',  'gold',       929),
  ('flex',     'duo',  'platinum',  1085),
  ('flex',     'duo',  'emerald',   2005),
  ('flex',     'duo',  'diamond',   2995),
  ('flex',     'duo',  'master',    8515),
  ('flex',     'duo',  'grandmaster', 12590),
  ('flex',     'duo',  'challenger', 21090);

-- Mesmo fallback de getWinBoostPrice (shared/pricing.ts): tier desconhecido
-- cai pro 'master' daquele modo; se nem isso existir, cai pro solo/diamond
-- geral (nunca deveria acontecer com os 10 tiers atuais, mas mantém a
-- função total como a versão TS).
create or replace function public.win_price_cents(
  p_queue public.queue_type,
  p_mode  text,
  p_tier  text
) returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select price_cents from public.win_price_cents_catalog where queue_type = p_queue and boost_mode = p_mode and tier = p_tier),
    (select price_cents from public.win_price_cents_catalog where queue_type = p_queue and boost_mode = p_mode and tier = 'master'),
    (select price_cents from public.win_price_cents_catalog where queue_type = 'solo_duo' and boost_mode = 'solo' and tier = 'diamond')
  );
$$;

revoke all on function public.win_price_cents(public.queue_type, text, text) from public, anon;
grant execute on function public.win_price_cents(public.queue_type, text, text) to authenticated, service_role;
