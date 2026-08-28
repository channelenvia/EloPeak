-- Colapsa master_plus_pricing pra 1 preço "cheio" por par (current_tier,
-- target_tier, queue_type) em vez de múltiplos degraus de PDL -- o desconto
-- contínuo de 5%/vitória (applyMasterPlusPdlDiscount, shared/pricing.ts) já
-- cuida sozinho da redução conforme o PDL sobe; os degraus intermediários
-- que existiam aqui (300/600/900/1200/1500) duplicavam esse desconto.
-- Fila Flex passa a ter o mesmo preço da Solo/Duo -- não há mais
-- diferenciação comercial por fila no Master+.
delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  ('master', 'grandmaster', 'solo_duo', 0, 1119.17),
  ('master', 'grandmaster', 'flex', 0, 1119.17),
  ('grandmaster', 'challenger', 'solo_duo', 0, 1598.87),
  ('grandmaster', 'challenger', 'flex', 0, 1598.87),
  ('master', 'challenger', 'solo_duo', 0, 2718.04),
  ('master', 'challenger', 'flex', 0, 2718.04);
