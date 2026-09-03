-- Gap: quando exclusive_until de um pedido reservado (preferred_booster_id)
-- expira sem o booster dono aceitar, available_boost_orders já libera o
-- pedido pra todos os boosters aprovados (migration 128, condição
-- `exclusive_until <= now()`) -- isso é só uma comparação de timestamp lida
-- a cada SELECT, nenhuma linha muda no banco nesse instante. discord-order-
-- channel só anuncia (DM exclusiva OU post público) na transição de STATUS
-- pra 'awaiting_assignment' (webhook em UPDATE/INSERT de orders) -- como o
-- status não muda quando a exclusividade expira, esse anúncio nunca dispara
-- de novo: o pedido volta pro pool geral silenciosamente, sem pingar o canal
-- público nenhuma vez.
--
-- Fix: announce-expired-exclusive-jobs (nova Edge Function, invocada por um
-- Cron Job do Supabase) varre periodicamente os pedidos que acabaram de
-- perder a exclusividade e ainda não foram anunciados publicamente, posta o
-- mesmo embed usado pro anúncio público normal (buildPublicJobEmbed, agora
-- em _shared/discordJobAnnounce.ts) e marca aqui pra nunca reanunciar o
-- mesmo pedido duas vezes.
alter table public.orders
  add column if not exists exclusive_expired_announced_at timestamptz;

-- Índice parcial -- só as linhas candidatas ao anúncio (reservadas, ainda na
-- pool, ainda não anunciadas) entram aqui; a maioria dos pedidos nunca passa
-- por este caminho, então o índice fica pequeno pro tamanho real da tabela.
create index if not exists idx_orders_pending_exclusive_expiry
  on public.orders (exclusive_until)
  where status = 'awaiting_assignment'
    and preferred_booster_id is not null
    and exclusive_expired_announced_at is null;
