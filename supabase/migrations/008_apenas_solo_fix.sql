-- ============================================================
-- Migration 008 — Apenas Solo: dedup + preço +20%
-- ============================================================

-- Remove duplicatas mantendo somente a linha com menor ctid (primeira inserida)
delete from public.service_extras a
  using public.service_extras b
  where a.name = 'Apenas Solo'
    and b.name = 'Apenas Solo'
    and a.ctid > b.ctid;

-- Garante preço correto e sort_order na linha restante
update public.service_extras
  set price_modifier_pct = 20,
      price_modifier     = 0,
      sort_order         = 1,
      icon               = 'user',
      description        = 'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.',
      is_active          = true
  where name = 'Apenas Solo';

-- Caso a linha não exista (banco sem migration 007), insere
insert into public.service_extras
  (name, description, price_modifier, price_modifier_pct, sort_order, icon, is_active)
select
  'Apenas Solo',
  'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.',
  0, 20, 1, 'user', true
where not exists (
  select 1 from public.service_extras where name = 'Apenas Solo'
);
