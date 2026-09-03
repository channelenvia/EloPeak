-- Corrige os valores comerciais do Boost Master+ (migration 028 tinha os
-- preços de Mestre->Grão-Mestre e Grão-Mestre->Challenger trocados/errados):
--   Mestre -> Grão-Mestre: R$ 899,90 (era R$ 1.249,90)
--   Grão-Mestre -> Challenger: R$ 1.249,90 (era R$ 2.149,80)
-- "master" continua só decorativo (ver comentário da migration 028) e não
-- muda aqui.

update public.master_plus_pricing set price = 899.90 where tier = 'grandmaster';
update public.master_plus_pricing set price = 1249.90 where tier = 'challenger';
