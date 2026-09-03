-- Cache do corte de PDL (LP do último colocado) das ligas Grão-Mestre e
-- Challenger na Riot, por fila -- usado só pra estimar prazo de entrega do
-- Boost Master+ (nunca o preço, que é fixo por tier -- migration 028).
-- Precisa ser cacheado: as ligas GM/Challenger têm centenas/milhares de
-- jogadores, então não dá pra consultar a Riot a cada pedido/visualização.
-- Atualizado pela edge function riot-league-cutoffs (service role), chamada
-- de forma preguiçosa pelo frontend quando o cache está velho (sem cron/
-- pg_net -- ver comentário na função).

create table public.riot_league_cutoffs (
  queue      public.queue_type not null,
  tier       text not null check (tier in ('grandmaster', 'challenger')),
  cutoff_lp  integer not null check (cutoff_lp >= 0),
  fetched_at timestamptz not null default now(),
  primary key (queue, tier)
);

comment on table public.riot_league_cutoffs is
  'Cache do corte de PDL (menor leaguePoints) das ligas Grão-Mestre/Challenger '
  'na Riot, por fila. Escrito só pela edge function riot-league-cutoffs '
  '(service role); lido pelo frontend (StepConfigure, detalhes de pedido) e '
  'por orderPricing.ts (estimativa de prazo do Master+).';

alter table public.riot_league_cutoffs enable row level security;

-- Leitura pública (mesmo padrão de master_plus_pricing/games/services): não é
-- dado sensível, é usado antes mesmo de logar pra mostrar estimativas.
create policy "riot_league_cutoffs_read" on public.riot_league_cutoffs
  for select using (true);

grant select on public.riot_league_cutoffs to anon, authenticated;
