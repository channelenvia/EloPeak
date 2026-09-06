-- Agenda o cron novo (Edge Function em cron-sync-order-matches) a cada 30
-- minutos. Mesmo padrão de 20260906220000 (payout/inactivity reminders):
-- x-webhook-secret lido de vault.decrypted_secrets em vez de literal na
-- migration, apikey anon (não é segredo) direto no corpo.
--
-- O secret (cron_sync_order_matches_secret) precisa ser criado à parte via
-- vault.create_secret, com o mesmo valor setado como env var
-- (CRON_SYNC_ORDER_MATCHES_SECRET) da Edge Function -- essa migration só
-- agenda a chamada, não cria o segredo.
--
-- Por quê 30min: mesmo intervalo do polling client-side em JobDetail.tsx
-- (AUTO_SYNC_INTERVAL_MS, src/lib/matchSync.ts) -- este cron é o backstop
-- server-side pro caso de ninguém ter a tela do pedido aberta. wins_played/
-- losses_played (base do cálculo de penalidade em apply_order_drop, ver
-- migration 20260906240000) ficam defasados sem sync recente.

do $$
begin
  perform cron.unschedule('cron-sync-order-matches');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'cron-sync-order-matches',
    '*/30 * * * *',
    $cron$
    select net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/cron-sync-order-matches',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_sync_order_matches_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
exception when undefined_function or insufficient_privilege then
  raise notice 'pg_cron scheduling unavailable — cron-sync-order-matches exists but is not scheduled';
end $$;
