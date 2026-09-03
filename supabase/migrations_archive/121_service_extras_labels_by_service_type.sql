-- Um addon (code) em service_extras é UMA linha compartilhada por todo
-- service_type que reaproveita seu flow: 'solo_standard' serve Elo Boost
-- Solo, Vitórias (win_boost), MD5 e Solo Clash; 'duo_standard' serve Elo
-- Boost Duo e Duo Clash (ver migration 111 e addonFlow em
-- supabase/functions/_shared/orderPricing.ts). O texto (name/description) foi
-- escrito pensando só em Elo Boost -- em Vitórias/MD5/Clash o mesmo addon
-- aparece com a mesma redação de Elo Boost, mesmo quando ela não faz sentido
-- ali (ex.: "durante a progressão" não existe em Duo Clash, que é uma
-- partida agendada, não uma progressão de rank).
--
-- service_type_overrides guarda como o MESMO addon (preço/flow/code
-- continuam únicos, uma linha só) deve ser chamado/descrito para os demais
-- service_types daquele flow. Chave ausente (ou campo ausente dentro dela)
-- sempre cai pro name/description base -- nunca texto vazio. Elo Boost nunca
-- precisa de override (o texto base já foi escrito pra ele).
alter table public.service_extras
  add column if not exists service_type_overrides jsonb not null default '{}'::jsonb;

alter table public.service_extras
  drop constraint if exists service_extras_service_type_overrides_is_object;
alter table public.service_extras
  add constraint service_extras_service_type_overrides_is_object
  check (jsonb_typeof(service_type_overrides) = 'object');

-- ── solo_standard (Vitórias/MD5/Solo Clash reaproveitam Elo Boost Solo) ─────

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'win_boost', jsonb_build_object('description', 'O booster joga exclusivamente em solo queue durante as vitórias contratadas, sem duo com outros jogadores.'),
  'md5', jsonb_build_object('description', 'O booster joga exclusivamente em solo queue durante as partidas da garantia MD5, sem duo com outros jogadores.'),
  'clash', jsonb_build_object('description', 'O booster disputa a partida de Clash sozinho na sua conta, sem contar com duo externo ao time formado dentro do jogo.')
)
where flow = 'solo_standard' and code = 'solo_only';

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'win_boost', jsonb_build_object('description', 'O booster joga seu campeão favorito em todas as vitórias contratadas, quando possível.'),
  'md5', jsonb_build_object('description', 'O booster joga seu campeão favorito em todas as partidas da garantia MD5, quando possível.'),
  'clash', jsonb_build_object('description', 'O booster joga seu campeão favorito na partida de Clash, quando possível dentro da composição do time.')
)
where flow = 'solo_standard' and code = 'mono_champ';

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'win_boost', jsonb_build_object('description', 'Assista seu booster jogar em tempo real durante todas as vitórias contratadas.'),
  'md5', jsonb_build_object('description', 'Assista seu booster jogar em tempo real durante as partidas da garantia MD5.'),
  'clash', jsonb_build_object('description', 'Assista seu booster jogar em tempo real durante a partida de Clash.')
)
where flow = 'solo_standard' and code = 'live_stream';

-- 'priority' (Acesso Prioritário) já é genérico o bastante (fila de
-- atribuição) -- nenhum override necessário, cai no texto base pra todos.

-- ── duo_standard (Duo Clash reaproveita Elo Boost Duo) ──────────────────────

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'clash', jsonb_build_object('description', 'A montagem do time de Clash pode envolver diferentes contas de apoio, sem depender de uma única conta booster fixa.')
)
where flow = 'duo_standard' and code = 'undetectable_duo';

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'clash', jsonb_build_object('description', 'O booster explica decisões, estratégias, movimentações e objetivos relevantes durante a partida de Clash.')
)
where flow = 'duo_standard' and code = 'explanatory_gameplay';

update public.service_extras
set service_type_overrides = jsonb_build_object(
  'clash', jsonb_build_object('description', 'Booster e cliente em comunicação pelo voice do jogo durante a partida de Clash.')
)
where flow = 'duo_standard' and code = 'duo_voice';
