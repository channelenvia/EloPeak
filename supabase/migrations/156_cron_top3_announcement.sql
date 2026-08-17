-- Agenda o recálculo do Top 3 + anúncio no Discord pra todo dia 15 e 30 do
-- mês, 12:00 UTC (09:00 America/Sao_Paulo). pg_cron e pg_net já vêm
-- habilitados neste projeto -- nenhuma infra nova precisa ser criada, só
-- agendar a chamada. discord-top3-announcement (edge function) já faz o
-- refresh_top3_boosters() + get_top_boosters() + post no Discord; aqui só
-- dispara a chamada HTTP autenticada por um secret dedicado
-- (DISCORD_CRON_SECRET, configurado como secret da function -- nunca no
-- código/migration em texto puro seria ideal, mas como pg_net precisa do
-- valor literal no corpo da chamada agendada, ele fica aqui do mesmo jeito
-- que ficaria em qualquer cron job deste tipo; o valor é de uso único pra
-- essa integração, não é reaproveitado em nenhum outro secret do projeto).
select cron.schedule(
  'discord-top3-announcement',
  '0 12 15,30 * *',
  $$
  select net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-top3-announcement',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
      'x-webhook-secret', '8fc0d1450bc3e7c18826ec8b15199b951537ad5a868a8d1e2d66884ab899f6da'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
