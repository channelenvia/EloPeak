-- Reverte a migration 161: o cliente não deve poder editar o próprio Riot ID
-- depois da criação do pedido -- se ele errou, o esperado é só ver o erro
-- (sem campo de correção). O erro "Riot ID/conta não encontrada" que
-- importa de verdade é do lado do BOOSTER, na conta duo própria (ver
-- migration 163).
drop function if exists public.update_order_riot_id(uuid, text);
