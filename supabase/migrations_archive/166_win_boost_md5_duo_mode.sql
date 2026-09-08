-- Duo Vitórias/MD5: mesmo esquema do Duo Boost (migration 111) -- em duo, o
-- cliente nunca fornece credenciais da própria conta; o booster joga com
-- Riot ID próprio ou reserva uma conta da plataforma (mesmo fluxo de
-- DuoAccountSection/resolve-duo-account-credentials, já genérico por
-- boost_mode, sem depender de service_type). Antes, win_boost/md5 SEMPRE
-- exigiam credenciais, mesmo em duo -- única diferença real pro elo_boost e
-- clash, que já tinham essa exceção.
create or replace function public.order_requires_access_token(
  p_service_type public.service_type,
  p_boost_mode text
) returns boolean
language sql
immutable
set search_path = public as $$
  select coalesce(p_boost_mode, 'solo') = 'solo'
    and p_service_type in ('elo_boost', 'win_boost', 'md5', 'clash')
$$;
