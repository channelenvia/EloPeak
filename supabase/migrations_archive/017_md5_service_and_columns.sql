-- MD5 win-rate-guarantee mode: reuses the 'md5' service_type enum value that
-- has existed since 001_initializing.sql but was never wired to a services
-- catalog row. It's presented in the UI as a toggle inside the existing
-- "Vitórias" (win_boost) step, not its own tile — but under the hood it is
-- its own service_type, priced and validated independently (see
-- shared/pricing.ts and create-pix-payment).

insert into public.services (game_id, type, name, description, short_description, is_active, sort_order)
select g.id, 'md5'::public.service_type,
       'MD5 — Garantia de Win Rate',
       'Suas partidas de posicionamento com garantia de 80%+ de win rate — se o resultado ficar abaixo disso, adicionamos vitórias extras até atingir o combinado.',
       'Garantia de Win Rate nas suas partidas de posicionamento',
       true, 5
from public.games g
where g.slug = 'lol'
on conflict (game_id, type) do nothing;

-- How many of the (up to 5) placement matches the booster will play — the
-- rest were already played by the customer. Purely informational for the
-- booster; never affects price (price is per net win purchased, see
-- shared/pricing.ts::getMd5WinPrice). Always re-derived server-side, never
-- trusted from the client.
alter table public.orders add column if not exists md5_matches_remaining smallint
  check (md5_matches_remaining is null or md5_matches_remaining between 0 and 5);
