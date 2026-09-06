-- Bug (MEDIUM x2): duas cópias vivas e mortas de tabelas de preço espelhadas
-- à mão de shared/pricing.ts, sem nenhum chamador real:
--
-- - win_penalty_price_cents + win_value_cents(): cópia órfã de WIN_PRICE_CENTS.
--   Confirmado ao vivo: win_value_cents() só é chamada por si mesma via a
--   tabela (nenhum outro proc a chama); apply_order_drop usa
--   win_price_cents()/win_price_cents_catalog, não esta.
-- - elo_div_price_cents: cópia órfã de ELO_DIV_PRICE_CENTS/_DUO. Confirmado
--   ao vivo: zero chamadores (nenhuma função no banco referencia a tabela).
--
-- Fix: derrubar as duas superfícies mortas pra uma cópia velha não poder
-- ressuscitar depois com valores desatualizados.
drop function if exists public.win_value_cents(text, text, text);
drop table if exists public.win_penalty_price_cents;
drop table if exists public.elo_div_price_cents;
