-- discord-order-channel já existe e já sabe anunciar "novo pedido
-- disponível" no canal de jobs (awaiting_assignment) e criar/apagar o canal
-- de voz do pedido (in_progress/terminal) -- mas supabase_functions.hooks
-- está vazia neste projeto: não existe (e talvez nunca existiu, ou foi
-- removido) um Database Webhook do Dashboard chamando essa function quando
-- orders.status muda. O código de anúncio nunca era executado. Em vez de
-- depender da configuração manual do Dashboard (não versionada, não visível
-- em migration nenhuma), cria um trigger direto usando pg_net (mesmo
-- mecanismo já usado pelo cron do Top 3) -- assíncrono, não bloqueia o
-- UPDATE/INSERT em orders esperando a resposta do Discord.
create or replace function public.notify_discord_order_webhook()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'record', jsonb_build_object(
      'id', new.id,
      'status', new.status,
      'discord_voice_channel_id', new.discord_voice_channel_id
    ),
    'old_record', jsonb_build_object(
      'status', case when tg_op = 'UPDATE' then old.status else null end
    )
  );

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-order-channel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeW5mcWp4cWJscmJ4eGlvYnR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDIxNjMsImV4cCI6MjA5Njg3ODE2M30.WWt_hqjNUFwEe9Ud-9IK-CE9lpMVcbqmT6kJssjuydE',
      'x-webhook-secret', '481e80771d5f766251a8cce6b7232b18b901493e3b51a522ad3862764cc72f55'
    ),
    body := v_payload,
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_discord_order_webhook on public.orders;
create trigger trg_notify_discord_order_webhook
after insert or update of status on public.orders
for each row execute function public.notify_discord_order_webhook();
