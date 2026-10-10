-- Baseline (parte 3): crons que chamam Edge Functions de PRODUCAO.
-- Agendados so onde os segredos do vault existem (producao); no banco local
-- (supabase db reset) sao ignorados para nao bater em producao.
-- A anon key e publica (role anon). Producao tinha um caractere a mais na
-- chave do job announce-stale-awaiting-assignment-jobs (causa dos 401, H-23).
set search_path = public, extensions;

do $cron$
declare
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE';
  v_job record;
begin
  for v_job in
    select * from (values
      ('announce-expired-exclusive-jobs',        '*/5 * * * *',    'announce-expired-exclusive-jobs',        'discord_exclusive_job_cron_secret',      15000),
      ('discord-top3-announcement',               '0 12 15,30 * *', 'discord-top3-announcement',               'discord_top3_cron_secret',               15000),
      ('discord-payout-window-reminder',          '0 12 15,30 * *', 'discord-payout-window-reminder',          'discord_payout_reminder_cron_secret',    30000),
      ('discord-customer-inactivity-reminder',    '0 13 * * *',     'discord-customer-inactivity-reminder',    'discord_inactivity_reminder_cron_secret', 30000),
      ('cron-sync-order-matches',                 '*/30 * * * *',   'cron-sync-order-matches',                 'cron_sync_order_matches_secret',         120000),
      ('announce-stale-awaiting-assignment-jobs', '*/5 * * * *',    'announce-stale-awaiting-assignment-jobs', 'discord_awaiting_assignment_cron_secret', 15000)
    ) as t(job_name, schedule, fn, secret_name, timeout_ms)
  loop
    if not exists (select 1 from vault.secrets where name = v_job.secret_name) then
      raise notice 'segredo % ausente: job % nao agendado', v_job.secret_name, v_job.job_name;
      continue;
    end if;
    perform cron.schedule(
      v_job.job_name, v_job.schedule,
      format($c$select net.http_post(
        url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', %L,
          'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = %L limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := %s
      );$c$, v_job.fn, v_anon, v_job.secret_name, v_job.timeout_ms));
  end loop;
end
$cron$;
