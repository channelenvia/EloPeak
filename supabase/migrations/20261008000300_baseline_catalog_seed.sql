-- Baseline (parte 4): seed dos catalogos de preco (dados de referencia que o dump
-- de schema nao cobre). Reflete producao em 2026-10-15; DO NOTHING preserva ajustes.
set search_path = public, extensions;

insert into public.elo_div_price_cents (queue_type, boost_mode, tier, cents)
select q, m, t.tier, t.cents
from unnest(array['solo_duo', 'flex']::public.queue_type[]) q,
     (values ('solo'), ('duo')) as mm(m),
     lateral (values
       ('solo', 'iron', 1090), ('solo', 'bronze', 1290), ('solo', 'silver', 1690), ('solo', 'gold', 2190),
       ('solo', 'platinum', 3190), ('solo', 'emerald', 6290), ('solo', 'diamond', 10290),
       ('duo', 'iron', 2090), ('duo', 'bronze', 2390), ('duo', 'silver', 2690), ('duo', 'gold', 3290),
       ('duo', 'platinum', 4890), ('duo', 'emerald', 9890), ('duo', 'diamond', 15790)
     ) as t(mode, tier, cents)
where t.mode = mm.m
on conflict do nothing;

INSERT INTO public.win_price_cents_catalog (queue_type, boost_mode, tier, price_cents) VALUES
  ('solo_duo', 'duo', 'bronze', 605),
  ('solo_duo', 'duo', 'challenger', 21090),
  ('solo_duo', 'duo', 'diamond', 2995),
  ('solo_duo', 'duo', 'emerald', 2005),
  ('solo_duo', 'duo', 'gold', 929),
  ('solo_duo', 'duo', 'grandmaster', 12590),
  ('solo_duo', 'duo', 'iron', 605),
  ('solo_duo', 'duo', 'master', 8515),
  ('solo_duo', 'duo', 'platinum', 1085),
  ('solo_duo', 'duo', 'silver', 795),
  ('solo_duo', 'solo', 'bronze', 458),
  ('solo_duo', 'solo', 'challenger', 14440),
  ('solo_duo', 'solo', 'diamond', 1685),
  ('solo_duo', 'solo', 'emerald', 1315),
  ('solo_duo', 'solo', 'gold', 567),
  ('solo_duo', 'solo', 'grandmaster', 8620),
  ('solo_duo', 'solo', 'iron', 458),
  ('solo_duo', 'solo', 'master', 5830),
  ('solo_duo', 'solo', 'platinum', 930),
  ('solo_duo', 'solo', 'silver', 479),
  ('flex', 'duo', 'bronze', 605),
  ('flex', 'duo', 'challenger', 21090),
  ('flex', 'duo', 'diamond', 2995),
  ('flex', 'duo', 'emerald', 2005),
  ('flex', 'duo', 'gold', 929),
  ('flex', 'duo', 'grandmaster', 12590),
  ('flex', 'duo', 'iron', 605),
  ('flex', 'duo', 'master', 8515),
  ('flex', 'duo', 'platinum', 1085),
  ('flex', 'duo', 'silver', 795),
  ('flex', 'solo', 'bronze', 458),
  ('flex', 'solo', 'challenger', 14440),
  ('flex', 'solo', 'diamond', 1685),
  ('flex', 'solo', 'emerald', 1315),
  ('flex', 'solo', 'gold', 567),
  ('flex', 'solo', 'grandmaster', 8620),
  ('flex', 'solo', 'iron', 458),
  ('flex', 'solo', 'master', 5830),
  ('flex', 'solo', 'platinum', 930),
  ('flex', 'solo', 'silver', 479)
ON CONFLICT (queue_type, boost_mode, tier) DO NOTHING;

INSERT INTO public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, boost_mode, price) VALUES
  ('grandmaster', 'challenger', 'solo_duo', 0, 'solo', 1698.87),
  ('grandmaster', 'challenger', 'flex', 0, 'duo', 3280.90),
  ('grandmaster', 'challenger', 'flex', 0, 'solo', 1698.87),
  ('master', 'challenger', 'solo_duo', 0, 'solo', 2918.04),
  ('master', 'challenger', 'flex', 0, 'duo', 5430.90),
  ('master', 'challenger', 'flex', 0, 'solo', 2918.04),
  ('master', 'grandmaster', 'solo_duo', 0, 'solo', 1219.17),
  ('master', 'grandmaster', 'flex', 0, 'duo', 2150.90),
  ('master', 'grandmaster', 'flex', 0, 'solo', 1219.17)
ON CONFLICT (current_tier, target_tier, queue_type, pdl_from, boost_mode) DO NOTHING;
