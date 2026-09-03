-- O time comercial simplificou a tabela de preço do Master+: os degraus
-- granulares de 25/100 PDL das migrations 093/098 dão lugar a uma tabela bem
-- mais enxuta.
--
-- SoloQ mantém degraus de PDL, mas bem mais largos:
--   Mestre -> Grão-Mestre: 4 degraus de 300 PDL (899,90 / 799,90 / 699,90 / 659,90)
--   Grão-Mestre -> Challenger: 2 degraus de 300 PDL (1.249,90 / 1.149,90)
--   Mestre -> Challenger direto: preço único (soma dos primeiros degraus das
--     duas progressões acima -- 899,90 + 1.249,90 = 2.149,80), sem desconto
--     por PDL (o time comercial não passou uma tabela própria para esta rota).
--
-- Flex perde os degraus de PDL por completo -- vira um preço único por par de
-- tier, igual ao valor de "Tier Completo (Solo)" passado pelo time comercial:
--   Mestre -> Grão-Mestre:      R$   699,90
--   Grão-Mestre -> Challenger:  R$ 1.049,90
--   Mestre -> Challenger direto: R$ 1.749,90
--
-- Lookup (ver supabase/functions/_shared/orderPricing.ts e StepConfigure.tsx)
-- não muda: maior pdl_from <= PDL atual do cliente, dentro do par (current_tier,
-- target_tier, queue_type). Flex sempre cai no único pdl_from=0 cadastrado,
-- efetivamente virando um preço fixo independente do PDL atual do cliente.

delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  -- Mestre -> Grão-Mestre (solo_duo)
  ('master','grandmaster','solo_duo',0,899.90),
  ('master','grandmaster','solo_duo',300,799.90),
  ('master','grandmaster','solo_duo',600,699.90),
  ('master','grandmaster','solo_duo',900,659.90),
  -- Grão-Mestre -> Challenger (solo_duo)
  ('grandmaster','challenger','solo_duo',1200,1249.90),
  ('grandmaster','challenger','solo_duo',1500,1149.90),
  -- Mestre -> Challenger direto (solo_duo) -- sem tabela própria, soma dos
  -- primeiros degraus das duas progressões acima
  ('master','challenger','solo_duo',0,2149.80),
  -- Mestre -> Grão-Mestre (flex) -- preço único, sem degrau de PDL
  ('master','grandmaster','flex',0,699.90),
  -- Grão-Mestre -> Challenger (flex) -- preço único, sem degrau de PDL
  ('grandmaster','challenger','flex',0,1049.90),
  -- Mestre -> Challenger direto (flex) -- preço único, sem degrau de PDL
  ('master','challenger','flex',0,1749.90);

comment on table public.master_plus_pricing is
  'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo, '
  'fila, degrau de PDL). SoloQ ainda varia por PDL (degraus de 300, mais '
  'barato quanto mais perto do corte do próximo tier); Flex tem um único '
  'preço fixo por par de tier (pdl_from=0), sem desconto por PDL. Lookup: '
  'maior pdl_from <= PDL atual do cliente para o par/fila; PDL acima do '
  'último degrau usa o preço do último (nunca fica sem preço). updated_by '
  'não tem FK pra profiles de propósito -- tabela de configuração comercial '
  'pura, não pode ser apagada por um truncate/cleanup de dados de usuário.';
