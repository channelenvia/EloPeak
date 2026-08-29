-- Reajuste dos preços cheios do Master+ (mesma estrutura da migration
-- 20260827120000 -- 1 preço "cheio" por par, pdl_from=0, Flex espelhando
-- Solo/Duo). Master->Grão-Mestre: R$1.119,17 -> R$1.219,17. Grão-Mestre-
-- >Challenger: R$1.598,87 -> R$1.698,87. Master->Challenger direto segue
-- sendo a soma dos dois: R$2.918,04.
delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  ('master', 'grandmaster', 'solo_duo', 0, 1219.17),
  ('master', 'grandmaster', 'flex', 0, 1219.17),
  ('grandmaster', 'challenger', 'solo_duo', 0, 1698.87),
  ('grandmaster', 'challenger', 'flex', 0, 1698.87),
  ('master', 'challenger', 'solo_duo', 0, 2918.04),
  ('master', 'challenger', 'flex', 0, 2918.04);
