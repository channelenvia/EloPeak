-- ============================================================
-- Migration 006 — Transmissão ao Vivo: cobrar +10% do preço base
-- ============================================================

update public.service_extras
  set price_modifier_pct = 10,
      price_modifier     = 0
  where lower(name) like '%transmiss%'
     or lower(name) like '%live stream%'
     or lower(name) like '%stream%';
