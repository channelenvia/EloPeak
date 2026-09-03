-- Credenciais de conta são necessárias exclusivamente para:
--   * Elo Boost no modo Solo (inclui o fluxo Master+, cujo boost_mode é solo)
--   * Vitórias
--   * MD5
-- Duo, Coaching e o placement_matches legado nunca devem pedir nem reter
-- credenciais.

create or replace function public.order_requires_access_token(
  p_service_type public.service_type,
  p_boost_mode text
) returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select
    (p_service_type = 'elo_boost' and coalesce(p_boost_mode, 'solo') = 'solo')
    or p_service_type in ('win_boost', 'md5')
$$;

-- Defesa de minimização de dados: se algum pedido legado de placement tiver
-- recebido credenciais pela regra anterior, descarte o payload agora.
update public.orders
set game_credentials = null,
    credentials_set = false,
    credential_expires_at = null,
    updated_at = now()
where service_type = 'placement_matches'
  and (credentials_set = true or game_credentials is not null or credential_expires_at is not null);
