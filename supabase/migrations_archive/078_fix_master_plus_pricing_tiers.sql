-- migration 068 corrigiu a troca entre grandmaster/challenger mas manteve os
-- dois abaixo do valor comercial correto definido para a página de preços:
--   master (decorativo, exibição):     R$   899,90 (inalterado)
--   grandmaster:                       R$ 1.249,90 (era R$   899,90)
--   challenger:                        R$ 2.149,90 (era R$ 1.249,90)

update public.master_plus_pricing set price = 1249.90 where tier = 'grandmaster';
update public.master_plus_pricing set price = 2149.90 where tier = 'challenger';

comment on table public.master_plus_pricing is
  'Preço comercial fixo por tier alvo do Boost Master+ (Master, Grão-Mestre, '
  'Challenger) — um único preço por tier, independente de qual tier o '
  'cliente parte e da faixa de PDL atual. Valores vigentes: Master R$899,90 '
  '(decorativo/exibição), Grão-Mestre R$1.249,90, Challenger R$2.149,90. Ver '
  'shared/pricing.ts::MASTER_PLUS_TIER_PRICE_CENTS para os mesmos valores em '
  'código (referência/teste); o preço autoritativo do pedido sempre vem '
  'desta tabela.';
