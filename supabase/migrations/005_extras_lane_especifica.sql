-- ============================================================
-- Migration 005 — Lane Específica: cobrar +5% do preço base
-- ============================================================

update public.service_extras
  set price_modifier_pct = 5,
      price_modifier     = 0
  where lower(name) like '%lane%específica%'
     or lower(name) like '%lane%especifica%'
     or lower(name) like '%lane específica%'
     or lower(name) like '%lane especifica%';
