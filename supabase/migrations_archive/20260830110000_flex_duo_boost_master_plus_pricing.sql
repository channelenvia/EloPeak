-- A Riot não restringe Duo por elo na fila Flex (só na Solo/Duo) -- Elo Boost
-- Duo até agora era bloqueado no Master+ em QUALQUER fila (decisão revertida
-- agora: Flex libera Duo em Master+, Solo/Duo continua bloqueando).
-- master_plus_pricing nunca teve dimensão de modalidade (só existia preço
-- solo) porque Duo nunca chegava lá -- precisa de uma coluna boost_mode pra
-- ter um preço próprio das novas combinações Duo/Flex.

alter table public.master_plus_pricing
  add column if not exists boost_mode text not null default 'solo';

alter table public.master_plus_pricing
  add constraint master_plus_pricing_boost_mode_check check (boost_mode in ('solo', 'duo'));

-- A unique key de (tier atual, tier alvo, fila, degrau de PDL) agora também
-- precisa da modalidade -- sem isso, solo e duo do mesmo par colidiriam.
alter table public.master_plus_pricing
  drop constraint if exists master_plus_pricing_pair_pdl_key;

alter table public.master_plus_pricing
  add constraint master_plus_pricing_pair_pdl_mode_key unique (current_tier, target_tier, queue_type, pdl_from, boost_mode);

-- Sem default daqui pra frente -- mesmo padrão de queue_type/pdl_from
-- (migration 093_master_plus_pricing_by_pdl): qualquer insert futuro precisa
-- informar boost_mode explicitamente.
alter table public.master_plus_pricing
  alter column boost_mode drop default;

-- Preços comerciais informados pelo negócio pra Duo Boost em Master+, só na
-- fila Flex (Solo/Duo segue sem linha duo -- fica sem preço configurado, e o
-- código bloqueia antes de chegar a consultar isso).
insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, boost_mode, price) values
  ('master', 'grandmaster', 'flex', 0, 'duo', 2150.90),
  ('grandmaster', 'challenger', 'flex', 0, 'duo', 3280.90),
  ('master', 'challenger', 'flex', 0, 'duo', 5430.90);

comment on table public.master_plus_pricing is
  'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo, '
  'fila, degrau de PDL, modalidade). SoloQ ainda varia por PDL (degraus de '
  '300, mais barato quanto mais perto do corte do próximo tier); Flex tem '
  'um único preço fixo por par de tier (pdl_from=0), sem desconto por PDL. '
  'Duo só existe pra fila Flex (Riot não restringe duo por elo lá; Solo/Duo '
  'segue sem Duo Boost em Master+, ver shared/boostDomain.ts getBoostFlow). '
  'Lookup: maior pdl_from <= PDL atual do cliente para o par/fila/'
  'modalidade; PDL acima do último degrau usa o preço do último (nunca fica '
  'sem preço). updated_by não tem FK pra profiles de propósito -- tabela de '
  'configuração comercial pura, não pode ser apagada por um truncate/'
  'cleanup de dados de usuário.';
