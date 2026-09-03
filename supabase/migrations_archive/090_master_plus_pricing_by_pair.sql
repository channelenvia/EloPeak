-- Duas correções nesta migration:
--
-- 1) master_plus_pricing ficou vazia depois do truncate de limpeza de dados
--    de usuário/teste (auth.users cascade) -- a coluna updated_by tinha FK
--    pra profiles(id), então TRUNCATE ... CASCADE arrastou junto uma tabela
--    de configuração comercial pura, que nunca deveria depender do ciclo de
--    vida de usuários. Remove essa FK (updated_by vira só um uuid solto, sem
--    referência) pra essa tabela nunca mais ser apagada por engano numa
--    limpeza de dados de usuário.
--
-- 2) O negócio corrigiu a regra de preço: não é mais um valor fixo por tier
--    ALVO (migration 028) -- volta a depender também do tier de ORIGEM,
--    porque Grão-Mestre->Challenger (1 tier de distância) é mais barato que
--    Mestre->Challenger (2 tiers de distância), mesmo tendo o mesmo destino.
--    Preços vigentes:
--      Mestre -> Grão-Mestre:     R$   899,90
--      Grão-Mestre -> Challenger: R$ 1.249,90
--      Mestre -> Challenger:      R$ 2.149,90

alter table public.master_plus_pricing
  drop constraint if exists master_plus_pricing_updated_by_fkey;

alter table public.master_plus_pricing
  drop constraint if exists master_plus_pricing_tier_check,
  drop constraint if exists master_plus_pricing_tier_key;

alter table public.master_plus_pricing
  drop column if exists tier,
  add column if not exists current_tier text,
  add column if not exists target_tier text;

alter table public.master_plus_pricing
  alter column current_tier set not null,
  alter column target_tier set not null;

alter table public.master_plus_pricing
  add constraint master_plus_pricing_progression_check check (
    (current_tier = 'master' and target_tier in ('grandmaster', 'challenger'))
    or (current_tier = 'grandmaster' and target_tier = 'challenger')
  ),
  add constraint master_plus_pricing_pair_key unique (current_tier, target_tier);

delete from public.master_plus_pricing;

insert into public.master_plus_pricing (current_tier, target_tier, price) values
  ('master', 'grandmaster', 899.90),
  ('grandmaster', 'challenger', 1249.90),
  ('master', 'challenger', 2149.90);

comment on table public.master_plus_pricing is
  'Preço comercial do Boost Master+, chaveado por (tier atual, tier alvo) -- '
  'depende de ambos porque a distância entre tiers importa (Grão-Mestre-> '
  'Challenger custa menos que Mestre->Challenger). Valores vigentes: '
  'Mestre->Grão-Mestre R$899,90, Grão-Mestre->Challenger R$1.249,90, '
  'Mestre->Challenger R$2.149,90. updated_by não tem FK pra profiles de '
  'propósito -- tabela de configuração comercial pura, não pode ser apagada '
  'por um truncate/cleanup de dados de usuário.';
