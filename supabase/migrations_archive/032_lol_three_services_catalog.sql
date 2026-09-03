-- Product catalog cleanup: this project sells only League of Legends and
-- three customer-facing services.
--
-- MD5 remains an internal order mode (`orders.service_type = 'md5'`) under
-- Vitórias, but it no longer has a separate row in public.services.

delete from public.services
where type not in ('elo_boost', 'win_boost', 'coaching');

delete from public.games
where slug <> 'lol';

update public.games
set
  name = 'League of Legends',
  is_active = true,
  sort_order = 1
where slug = 'lol';

update public.services
set
  name = case type
    when 'elo_boost' then 'Elo Boost'
    when 'win_boost' then 'Vitórias / MD5'
    when 'coaching' then 'Coaching'
    else name
  end,
  short_description = case type
    when 'elo_boost' then 'Suba do rank atual até o rank desejado'
    when 'win_boost' then 'Vitórias avulsas ou garantia MD5'
    when 'coaching' then 'Coaching 1-on-1 com players de alto elo'
    else short_description
  end,
  is_active = true,
  sort_order = case type
    when 'elo_boost' then 1
    when 'win_boost' then 2
    when 'coaching' then 3
    else sort_order
  end;
