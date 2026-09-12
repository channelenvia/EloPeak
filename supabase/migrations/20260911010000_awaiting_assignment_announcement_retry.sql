-- Gap (achado em auditoria): discord-order-channel anuncia a entrada em
-- awaiting_assignment (DM exclusiva ou post público no canal de jobs) via
-- Database Webhook fire-and-forget -- se a chamada falhar (Discord fora do
-- ar, rate limit, erro do próprio bot) não existe retry nem fila: o pedido
-- fica pronto pra pegar mas nunca anunciado, "invisível" pro operacional até
-- alguém notar manualmente. announce-expired-exclusive-jobs já tem esse tipo
-- de rede de segurança pra exclusividade expirada (migration 20260827100000)
-- -- este mirra o mesmo padrão pro anúncio inicial.
--
-- awaiting_assignment_announced_at é zerado por discord-order-channel antes
-- de tentar anunciar (a cada nova entrada em awaiting_assignment, inclusive
-- reaberturas por drop/reatribuição) e setado só depois do envio ter sucesso
-- -- fica null exatamente enquanto o anúncio deste ciclo ainda não foi
-- confirmado, que é a condição que announce-stale-awaiting-assignment-jobs
-- usa pra decidir o que reenviar.
alter table public.orders
  add column if not exists awaiting_assignment_announced_at timestamptz;

-- Índice parcial -- só pedidos candidatos ao retry (na pool, ainda não
-- confirmados) entram aqui.
create index if not exists idx_orders_pending_awaiting_assignment_announce
  on public.orders (updated_at)
  where status = 'awaiting_assignment'
    and awaiting_assignment_announced_at is null;

-- ─── Cron (NÃO aplicado por esta sessão -- ver nota abaixo) ────────────────
-- Antes de rodar isto: 1) fazer deploy da Edge Function
-- announce-stale-awaiting-assignment-jobs; 2) criar o secret
-- DISCORD_AWAITING_ASSIGNMENT_CRON_SECRET nas env vars da function; 3) criar
-- o mesmo valor no Vault (`select vault.create_secret('<valor>',
-- 'discord_awaiting_assignment_cron_secret')`). Cadência de 5 min, mesma de
-- announce-expired-exclusive-jobs -- BATCH_LIMIT=25 na function e o índice
-- parcial acima mantêm isso barato.
--
-- select cron.schedule(
--   'announce-stale-awaiting-assignment-jobs',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/announce-stale-awaiting-assignment-jobs',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', '<ANON_KEY -- copiar do valor já usado nos outros cron.schedule desta pasta>',
--       'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_awaiting_assignment_cron_secret' limit 1)
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 15000
--   );
--   $$
-- );
