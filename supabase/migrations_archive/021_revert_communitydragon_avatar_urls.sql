-- Reverte a mutação de dados feita em 019_public_booster_profiles_avatar_url.sql,
-- que reescreveu avatar_url de ddragon.leagueoflegends.com para
-- raw.communitydragon.org. A CSP do site nunca liberou communitydragon.org
-- (ver vercel.json), então qualquer usuário que já tivesse escolhido um ícone
-- antes daquela migração passou a ter um avatar_url bloqueado/quebrado.
--
-- Não editamos 019 retroativamente (migração já aplicada); em vez disso
-- corrigimos os dados existentes daqui pra frente. A partir de agora
-- src/lib/riotAssets.ts só produz URLs ddragon.leagueoflegends.com via o
-- proxy interno riot-profile-icons, então não há mais escrita nova nesse
-- formato — apenas os registros legados precisam ser corrigidos.
update public.profiles
set avatar_url = regexp_replace(
  avatar_url,
  '^https://raw\.communitydragon\.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/([0-9]+)\.jpg$',
  'https://ddragon.leagueoflegends.com/cdn/img/profileicon/\1.png'
)
where avatar_url ~ '^https://raw\.communitydragon\.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/[0-9]+\.jpg$';
