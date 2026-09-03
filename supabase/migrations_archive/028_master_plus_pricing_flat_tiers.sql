-- Master+ pricing simplification: o negócio decidiu um preço fixo por tier
-- alvo (Mestre, Grão-Mestre, Challenger), independente de qual tier o
-- cliente parte e da faixa de PDL atual — substitui a matriz antiga
-- (current_tier × target_tier × pdl_bracket), que exigia 12 combinações
-- configuradas e ainda deixava buracos (ex.: Master->Challenger direto).
--
-- Esta é uma tabela de configuração comercial pura (nenhuma FK a partir de
-- orders — o preço pago fica sempre congelado em orders.base_price), então
-- restruturá-la não afeta nenhum pedido histórico.

alter table public.master_plus_pricing
  drop constraint if exists master_plus_pricing_tier_check,
  drop constraint if exists master_plus_pricing_tier_key,
  drop constraint if exists master_plus_pricing_progression_check,
  drop constraint if exists master_plus_pricing_current_tier_check,
  drop constraint if exists master_plus_pricing_target_tier_check,
  drop constraint if exists master_plus_pricing_pdl_bracket_check,
  drop constraint if exists master_plus_pricing_current_tier_target_tier_pdl_bracket_key;

delete from public.master_plus_pricing;

alter table public.master_plus_pricing
  drop column if exists current_tier,
  drop column if exists target_tier,
  drop column if exists pdl_bracket,
  add column if not exists tier text;

alter table public.master_plus_pricing
  alter column tier set not null,
  add constraint master_plus_pricing_tier_check check (tier in ('master', 'grandmaster', 'challenger')),
  add constraint master_plus_pricing_tier_key unique (tier);

-- "master" existe só para exibição na página pública de preços — ninguém
-- efetivamente compra o tier Master através do fluxo Master+, que só existe
-- quando o rank ATUAL já é Master/Grão-Mestre (ver
-- shared/boostDomain.ts::isMasterPlusCurrentTier). O preço que de fato
-- restringe um pedido é sempre o do tier ALVO escolhido (grandmaster ou
-- challenger) — ver supabase/functions/_shared/orderPricing.ts.
insert into public.master_plus_pricing (tier, price) values
  ('master', 899.90),
  ('grandmaster', 1249.90),
  ('challenger', 2149.80)
on conflict (tier) do update
set price = excluded.price;

comment on table public.master_plus_pricing is
  'Preço comercial fixo por tier alvo do Boost Master+ (Master, Grão-Mestre, '
  'Challenger) — um único preço por tier, independente de qual tier o '
  'cliente parte e da faixa de PDL atual. Ver shared/pricing.ts::'
  'MASTER_PLUS_TIER_PRICE_CENTS para os mesmos valores em código (referência/'
  'teste); o preço autoritativo do pedido sempre vem desta tabela.';

comment on column public.master_plus_pricing.tier is
  'Tier ao qual este preço se refere. O rank ATUAL do cliente no fluxo '
  'Master+ só pode ser Master ou Grão-Mestre — a linha "master" existe só '
  'para exibição na página pública de preços.';
