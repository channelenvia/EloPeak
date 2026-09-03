-- Gap: a migration 20260827100000 criou a coluna/índice pra
-- announce-expired-exclusive-jobs (Edge Function) mas o Cron Job do Supabase
-- que deveria invocá-la periodicamente nunca foi criado -- a function ficou
-- deployed e sem ninguém chamando, exclusividade expirando silenciosamente
-- sem anúncio nenhum no canal de jobs do Discord. Mesmo padrão do job 9
-- (discord-top3-announcement): net.http_post com apikey anon + x-webhook-secret
-- próprio (DISCORD_EXCLUSIVE_JOB_CRON_SECRET, setado fora do banco).
--
-- A cada 5 minutos (mesma cadência de expire_stale_booster_suspensions, job 8)
-- -- BATCH_LIMIT=25 na function e o índice parcial de 20260827100000 mantêm
-- isso barato mesmo rodando com frequência.
--
-- x-webhook-secret lido de vault.decrypted_secrets (mesmo padrão de
-- 'credential_key' em 20260828120000) em vez de literal na migration -- job 9
-- (discord-top3-announcement) embutiu o valor direto no comando do
-- cron.schedule antigo, mas isso grava o segredo em texto puro no histórico
-- de migrations versionado no git; aqui evitamos repetir esse padrão. O
-- secret em si (nome 'discord_exclusive_job_cron_secret') é criado fora desta
-- migration via vault.create_secret, e o mesmo valor precisa ser setado como
-- env var DISCORD_EXCLUSIVE_JOB_CRON_SECRET da Edge Function (fora do banco).
select cron.schedule(
  'announce-expired-exclusive-jobs',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/announce-expired-exclusive-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_exclusive_job_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
