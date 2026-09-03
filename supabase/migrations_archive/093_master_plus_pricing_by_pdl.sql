-- Preço do Master+ deixa de ser fixo por par de tier (migration 090) e passa
-- a variar por PDL atual, a cada 100 PDL -- e passa a existir por fila
-- (solo_duo/flex), o que nunca existiu nesta tabela até agora.
--
-- Lookup (ver supabase/functions/_shared/orderPricing.ts e StepConfigure.tsx):
-- maior pdl_from <= PDL atual do cliente, dentro do par
-- (current_tier, target_tier, queue_type). PDL acima do último degrau
-- listado (ex.: >1100 para Mestre->Grão-Mestre) usa o preço do último degrau
-- -- nunca fica sem preço por estourar a tabela, e não depende de acompanhar
-- o corte ao vivo de GM/Challenger (riot_league_cutoffs) pra ter uma faixa
-- de preço válida.
--
-- Fila Flex usa ~5% de desconto sobre a SoloQ (mesmo patamar do desconto já
-- aplicado nas tabelas de divisão Iron-Diamond -- ex.: Diamond R$74,90 solo_duo
-- vs R$71,10 flex ≈ 5,07% -- Master+ nunca discriminou por fila até agora).
--
-- Preços SoloQ vieram do time comercial; Flex foi derivado (preço solo × 0,95,
-- arredondado ao centavo) por não haver tabela comercial própria pra fila
-- Flex em Master+ ainda.

alter table public.master_plus_pricing
  add column if not exists queue_type public.queue_type not null default 'solo_duo',
  add column if not exists pdl_from integer not null default 0;

alter table public.master_plus_pricing
  add constraint master_plus_pricing_pdl_from_check check (pdl_from >= 0);

alter table public.master_plus_pricing
  drop constraint if exists master_plus_pricing_pair_key;

alter table public.master_plus_pricing
  add constraint master_plus_pricing_pair_pdl_key unique (current_tier, target_tier, queue_type, pdl_from);

delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  -- Mestre -> Grão-Mestre (solo_duo)
  ('master','grandmaster','solo_duo',0,899.90),
  ('master','grandmaster','solo_duo',100,824.90),
  ('master','grandmaster','solo_duo',200,744.90),
  ('master','grandmaster','solo_duo',300,669.90),
  ('master','grandmaster','solo_duo',400,594.90),
  ('master','grandmaster','solo_duo',500,520.00),
  ('master','grandmaster','solo_duo',600,440.00),
  ('master','grandmaster','solo_duo',700,364.90),
  ('master','grandmaster','solo_duo',800,290.00),
  ('master','grandmaster','solo_duo',900,210.00),
  ('master','grandmaster','solo_duo',1000,135.90),
  ('master','grandmaster','solo_duo',1100,60.00),
  -- Grão-Mestre -> Challenger (solo_duo)
  ('grandmaster','challenger','solo_duo',1200,1249.90),
  ('grandmaster','challenger','solo_duo',1300,1010.00),
  ('grandmaster','challenger','solo_duo',1400,810.00),
  ('grandmaster','challenger','solo_duo',1500,610.00),
  ('grandmaster','challenger','solo_duo',1600,410.00),
  ('grandmaster','challenger','solo_duo',1700,210.00),
  -- Mestre -> Challenger direto (solo_duo)
  ('master','challenger','solo_duo',0,2150.00),
  ('master','challenger','solo_duo',100,2030.00),
  ('master','challenger','solo_duo',200,1910.00),
  ('master','challenger','solo_duo',300,1790.00),
  ('master','challenger','solo_duo',400,1670.00),
  ('master','challenger','solo_duo',500,1550.00),
  ('master','challenger','solo_duo',600,1434.90),
  ('master','challenger','solo_duo',700,1314.90),
  ('master','challenger','solo_duo',800,1194.90),
  ('master','challenger','solo_duo',900,1074.90),
  ('master','challenger','solo_duo',1000,954.90),
  ('master','challenger','solo_duo',1100,834.90),
  ('master','challenger','solo_duo',1200,714.90),
  ('master','challenger','solo_duo',1300,594.90),
  ('master','challenger','solo_duo',1400,474.90),
  ('master','challenger','solo_duo',1500,354.90),
  ('master','challenger','solo_duo',1600,240.00),
  ('master','challenger','solo_duo',1700,120.00),
  -- Mestre -> Grão-Mestre (flex, ≈5% abaixo da SoloQ)
  ('master','grandmaster','flex',0,854.91),
  ('master','grandmaster','flex',100,783.66),
  ('master','grandmaster','flex',200,707.66),
  ('master','grandmaster','flex',300,636.41),
  ('master','grandmaster','flex',400,565.16),
  ('master','grandmaster','flex',500,494.00),
  ('master','grandmaster','flex',600,418.00),
  ('master','grandmaster','flex',700,346.66),
  ('master','grandmaster','flex',800,275.50),
  ('master','grandmaster','flex',900,199.50),
  ('master','grandmaster','flex',1000,129.10),
  ('master','grandmaster','flex',1100,57.00),
  -- Grão-Mestre -> Challenger (flex)
  ('grandmaster','challenger','flex',1200,1187.41),
  ('grandmaster','challenger','flex',1300,959.50),
  ('grandmaster','challenger','flex',1400,769.50),
  ('grandmaster','challenger','flex',1500,579.50),
  ('grandmaster','challenger','flex',1600,389.50),
  ('grandmaster','challenger','flex',1700,199.50),
  -- Mestre -> Challenger direto (flex)
  ('master','challenger','flex',0,2042.50),
  ('master','challenger','flex',100,1928.50),
  ('master','challenger','flex',200,1814.50),
  ('master','challenger','flex',300,1700.50),
  ('master','challenger','flex',400,1586.50),
  ('master','challenger','flex',500,1472.50),
  ('master','challenger','flex',600,1363.16),
  ('master','challenger','flex',700,1249.16),
  ('master','challenger','flex',800,1135.16),
  ('master','challenger','flex',900,1021.16),
  ('master','challenger','flex',1000,907.16),
  ('master','challenger','flex',1100,793.16),
  ('master','challenger','flex',1200,679.16),
  ('master','challenger','flex',1300,565.16),
  ('master','challenger','flex',1400,451.16),
  ('master','challenger','flex',1500,337.16),
  ('master','challenger','flex',1600,228.00),
  ('master','challenger','flex',1700,114.00);

-- Sem default daqui pra frente -- qualquer insert futuro (admin) precisa
-- informar queue_type e pdl_from explicitamente, nunca cair num valor
-- implícito por engano.
alter table public.master_plus_pricing
  alter column queue_type drop default,
  alter column pdl_from drop default;

comment on table public.master_plus_pricing is
  'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo, '
  'fila, degrau de PDL) -- varia a cada 100 PDL, ficando mais barato quanto '
  'mais perto o cliente já está do corte do próximo tier. Lookup: maior '
  'pdl_from <= PDL atual do cliente para o par/fila; PDL acima do último '
  'degrau usa o preço do último (nunca fica sem preço). updated_by não tem '
  'FK pra profiles de propósito -- tabela de configuração comercial pura, '
  'não pode ser apagada por um truncate/cleanup de dados de usuário.';
