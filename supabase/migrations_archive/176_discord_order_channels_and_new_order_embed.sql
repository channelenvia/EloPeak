-- discord-order-channel agora cria um canal de TEXTO junto com o de voz
-- (só para pedidos com addon de voice/compartilhar tela) -- precisa de uma
-- coluna própria pra rastrear o canal de texto, do mesmo jeito que
-- discord_voice_channel_id já rastreia o de voz.
alter table public.orders
  add column if not exists discord_text_channel_id text;

-- Atualiza o payload do webhook (trigger criado na migration 157) para
-- incluir o novo campo, mantendo o mesmo padrão de pré-checagem barata
-- (existingChannelId) usado hoje antes do refetch autoritativo no banco.
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
      'discord_voice_channel_id', new.discord_voice_channel_id,
      'discord_text_channel_id', new.discord_text_channel_id
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
