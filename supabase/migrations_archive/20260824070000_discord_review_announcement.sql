-- Toda avaliação enviada pelo cliente no fim de um pedido (public.reviews,
-- RLS reviews_customer_insert) agora também vira uma mensagem no canal de
-- reviews do Discord (1515456626688266240) -- nota em estrelas, booster e
-- cliente associados. Mesmo padrão assíncrono via pg_net já usado pelos
-- outros webhooks internos (notify_discord_chat_mention, migration
-- 20260824030000; notify_discord_order_webhook, migrations 157/176/177):
-- trigger só dispara a chamada, nunca bloqueia o insert nem falha a
-- avaliação se o Discord estiver fora do ar (net.http_post é fire-and-
-- forget, erro de rede não propaga pro caller). Reaproveita o mesmo secret
-- discord_webhook_secret do Vault -- mesma superfície de confiança (trigger
-- interno do banco chamando edge function interna), sem provisionar mais um.
create or replace function public.notify_discord_review()
returns trigger
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

  perform net.http_post(
    url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-review-announcement',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object('review_id', new.id),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_discord_review on public.reviews;
create trigger trg_notify_discord_review
after insert on public.reviews
for each row
execute function public.notify_discord_review();
