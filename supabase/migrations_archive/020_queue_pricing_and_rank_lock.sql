-- Atualiza os valores comerciais de master_plus_pricing para as transições
-- Master->Grão-Mestre e Grão-Mestre->Challenger conforme a tabela oficial —
-- o mesmo valor nas 4 faixas de PDL e nas duas filas (solo_duo e flex), já
-- que o negócio não diferenciou por faixa/fila nesta rodada. Idempotente:
-- roda quantas vezes for aplicada, sempre convergindo para os mesmos valores.
update public.master_plus_pricing
set price = 899.90, updated_at = now()
where current_tier = 'master' and target_tier = 'grandmaster';

update public.master_plus_pricing
set price = 1249.90, updated_at = now()
where current_tier in ('master', 'grandmaster') and target_tier = 'challenger';

comment on table public.master_plus_pricing is
  'Preço comercial fixo para progressões Master+ (Master->GM, GM/Master->Challenger). '
  'Mesmo valor nas 4 faixas de PDL e nas duas filas (solo_duo/flex) — ver shared/pricing.ts '
  '::MASTER_PLUS_TRANSITION_PRICE_CENTS para os mesmos valores em código, usados só como '
  'referência/teste; o preço autoritativo do pedido sempre vem desta tabela.';
