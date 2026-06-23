-- ============================================================
-- Migration 007 — Extras: Apenas Solo + novos preços e ordem
-- ============================================================

-- Renomeia Lane Específica → Apenas Solo (gratuito, preferência)
update public.service_extras
  set name               = 'Apenas Solo',
      description        = 'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.',
      icon               = 'user',
      price_modifier     = 0,
      price_modifier_pct = 0,
      sort_order         = 1
  where lower(name) like '%lane%'
     or lower(name) like '%específica%'
     or lower(name) like '%especifica%';

-- Processamento Prioritário → ordem 2
update public.service_extras
  set sort_order = 2
  where lower(name) like '%priorit%';

-- Campeão Único → +10%, ordem 3
update public.service_extras
  set price_modifier_pct = 10,
      price_modifier     = 0,
      sort_order         = 3
  where lower(name) like '%camp%' and lower(name) like '%nico%';

-- Transmissão ao Vivo → ordem 4 (preço +10% já definido em 006)
update public.service_extras
  set sort_order = 4
  where lower(name) like '%transmiss%'
     or lower(name) like '%stream%';
