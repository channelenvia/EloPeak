-- Mesmo problema de save_duo_account (migration 091): onboard_booster
-- acumulou 3 overloads ao longo de migrations sucessivas que foram
-- adicionando campos (full_name/cpf, depois available_days) via
-- `create or replace function` com uma lista de parâmetros diferente a cada
-- vez -- isso cria um overload NOVO, nunca substitui o antigo. O frontend
-- (src/api/boosters/mutations.ts::onboardBooster) sempre envia o payload
-- completo de 9 parâmetros; as versões de 6 e 8 parâmetros são só risco de
-- ambiguidade de overload no PostgREST (erro PGRST203), nunca de fato
-- usadas. Mantém só a versão completa.
drop function if exists public.onboard_booster(
  p_display_name text,
  p_bio text,
  p_peak_rank jsonb,
  p_opgg_link text,
  p_hours_per_day_min integer,
  p_hours_per_day_max integer
);

drop function if exists public.onboard_booster(
  p_display_name text,
  p_bio text,
  p_peak_rank jsonb,
  p_opgg_link text,
  p_hours_per_day_min integer,
  p_hours_per_day_max integer,
  p_full_name text,
  p_cpf text
);
