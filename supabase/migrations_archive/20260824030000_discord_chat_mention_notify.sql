-- Quando alguém é @mencionado no chat de um pedido (send_order_message,
-- migration 20260814090000), o mencionado já recebe uma notificação in-app
-- normal (public.notifications, type='chat_mention') -- mas se ele não
-- estiver com o site aberto, só vê depois. Esse trigger manda também um DM
-- no Discord do usuário mencionado (cliente, booster ou admin, os 3 podem
-- ser mencionados), com botão direto pro pedido em questão.
--
-- Trigger em public.notifications (não dentro de send_order_message) pra não
-- acoplar a RPC de chat a uma chamada de rede -- mesmo padrão assíncrono via
-- pg_net do notify_discord_order_webhook (migration 177), reaproveitando o
-- mesmo secret: mesma superfície de confiança (trigger interno do banco
-- chamando edge function interna), sem precisar provisionar mais um secret
-- no Vault só pra isso.
create or replace function public.notify_discord_chat_mention()
returns trigger
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-chat-mention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'order_id', new.data->>'order_id',
      'body', new.body
    ),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_discord_chat_mention on public.notifications;
create trigger trg_notify_discord_chat_mention
after insert on public.notifications
for each row
when (new.type = 'chat_mention')
execute function public.notify_discord_chat_mention();
