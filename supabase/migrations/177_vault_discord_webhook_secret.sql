-- Revisão de segurança (background review) apontou que
-- notify_discord_order_webhook() (migrations 157/176) guardava o
-- DISCORD_WEBHOOK_SECRET e a anon key em texto puro dentro do corpo da
-- function -- qualquer leitura do repositório/git history expunha o
-- secret usado pra autenticar as chamadas ao edge function
-- discord-order-channel. O secret antigo já foi rotacionado (novo valor
-- gravado em vault.secrets como 'discord_webhook_secret', fora de
-- qualquer migration) e o DISCORD_WEBHOOK_SECRET da function foi
-- atualizado pra bater com o valor novo -- a partir daqui a function lê o
-- valor do Vault em vez de um literal.
create or replace function public.notify_discord_order_webhook()
returns trigger
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_payload jsonb;
  v_webhook_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_webhook_secret from vault.decrypted_secrets where name = 'discord_webhook_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_functions_anon_key';

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
      'apikey', v_anon_key,
      'x-webhook-secret', v_webhook_secret
    ),
    body := v_payload,
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;
