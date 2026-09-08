-- Reajuste comercial de +30% em toda a tabela de preços do Boost Master+ --
-- mesmo reajuste aplicado ao restante do catálogo (Elo Boost Iron-Diamond,
-- Vitória Avulsa/MD5, Clash) nesta rodada de preços. Mantém a estrutura de
-- degraus de PDL da migration 099 (SoloQ com desconto por degrau, Flex com
-- preço único), só escala cada valor por 1.3.
--
-- SoloQ (degraus de 300 PDL, preço cai quanto mais perto do corte):
--   Mestre -> Grão-Mestre: 1.169,87 / 1.039,87 / 909,87 / 857,87
--   Grão-Mestre -> Challenger: 1.624,87 / 1.494,87
--   Mestre -> Challenger direto: 2.794,74 (soma dos primeiros degraus acima)
--
-- Flex (preço único, sem degrau de PDL):
--   Mestre -> Grão-Mestre: 909,87
--   Grão-Mestre -> Challenger: 1.364,87
--   Mestre -> Challenger direto: 2.274,87
--
-- shared/pricing.ts::MASTER_PLUS_TIER_PRICE_CENTS (preço EXIBIDO na página
-- pública) foi atualizado junto para os mesmos valores do primeiro degrau
-- solo_duo (master: 1.169,87, grandmaster: 1.624,87, challenger: 2.794,74) --
-- ver shared/boostConfigSeed.test.ts, que amarra os dois.

delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  -- Mestre -> Grão-Mestre (solo_duo)
  ('master','grandmaster','solo_duo',0,1169.87),
  ('master','grandmaster','solo_duo',300,1039.87),
  ('master','grandmaster','solo_duo',600,909.87),
  ('master','grandmaster','solo_duo',900,857.87),
  -- Grão-Mestre -> Challenger (solo_duo)
  ('grandmaster','challenger','solo_duo',1200,1624.87),
  ('grandmaster','challenger','solo_duo',1500,1494.87),
  -- Mestre -> Challenger direto (solo_duo) -- soma dos primeiros degraus acima
  ('master','challenger','solo_duo',0,2794.74),
  -- Mestre -> Grão-Mestre (flex) -- preço único, sem degrau de PDL
  ('master','grandmaster','flex',0,909.87),
  -- Grão-Mestre -> Challenger (flex) -- preço único, sem degrau de PDL
  ('grandmaster','challenger','flex',0,1364.87),
  -- Mestre -> Challenger direto (flex) -- preço único, sem degrau de PDL
  ('master','challenger','flex',0,2274.87);

comment on table public.master_plus_pricing is
  'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo, '
  'fila, degrau de PDL). SoloQ ainda varia por PDL (degraus de 300, mais '
  'barato quanto mais perto do corte do próximo tier); Flex tem um único '
  'preço fixo por par de tier (pdl_from=0), sem desconto por PDL. Lookup: '
  'maior pdl_from <= PDL atual do cliente para o par/fila; PDL acima do '
  'último degrau usa o preço do último (nunca fica sem preço). Reajuste de '
  '+30% aplicado pela migration 146 sobre a base da 099. updated_by não tem '
  'FK pra profiles de propósito -- tabela de configuração comercial pura, '
  'não pode ser apagada por um truncate/cleanup de dados de usuário.';
