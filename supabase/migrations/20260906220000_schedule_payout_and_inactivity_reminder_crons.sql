-- Agenda os dois crons novos (Edge Functions em
-- discord-payout-window-reminder e discord-customer-inactivity-reminder).
-- Mesmo padrão de announce-expired-exclusive-jobs (migrations_archive
-- 20260831130000): x-webhook-secret lido de vault.decrypted_secrets em vez
-- de literal na migration, apikey anon (não é segredo) direto no corpo.
--
-- Cada secret (discord_payout_reminder_cron_secret /
-- discord_inactivity_reminder_cron_secret) precisa ser criado à parte via
-- vault.create_secret, com o mesmo valor setado como env var
-- (DISCORD_PAYOUT_REMINDER_CRON_SECRET / DISCORD_INACTIVITY_REMINDER_CRON_SECRET)
-- de cada Edge Function -- essa migration só agenda a chamada, não cria o
-- segredo.

do $$
begin
  perform cron.unschedule('discord-payout-window-reminder');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'discord-payout-window-reminder',
    '0 12 15,30 * *',
    $cron$
    select net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-payout-window-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_payout_reminder_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $cron$
  );
exception when undefined_function or insufficient_privilege then
  raise notice 'pg_cron scheduling unavailable — discord-payout-window-reminder exists but is not scheduled';
end $$;

do $$
begin
  perform cron.unschedule('discord-customer-inactivity-reminder');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'discord-customer-inactivity-reminder',
    '0 13 * * *',
    $cron$
    select net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-customer-inactivity-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_inactivity_reminder_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $cron$
  );
exception when undefined_function or insufficient_privilege then
  raise notice 'pg_cron scheduling unavailable — discord-customer-inactivity-reminder exists but is not scheduled';
end $$;
