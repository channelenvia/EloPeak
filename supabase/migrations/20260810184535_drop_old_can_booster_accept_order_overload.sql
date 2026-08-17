-- create or replace com uma assinatura nova (parâmetro extra) cria um
-- OVERLOAD em vez de substituir -- a versão antiga de 2 argumentos
-- (sem p_service_type, sem a regra de coaching ilimitado) ficou órfã
-- na migration 20260810184319_coaching_unlimited_slots. Remove pra não ter
-- duas versões divergentes da mesma regra de negócio coexistindo.
drop function if exists public.can_booster_accept_order(uuid, text);
