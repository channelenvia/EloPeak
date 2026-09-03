-- Guarda o LP (PDL) capturado na verificação de rank -- a Riot já retorna
-- leaguePoints junto da entry de league-v4 (ver _shared/riotLookup.ts), mas
-- verify-order-rank descartava o valor. Usado pra exibir "X PDL" ao lado do
-- rank atual na trilha de progresso (RankProgressionRail).
alter table public.order_rank_verifications
  add column if not exists fetched_lp integer;
