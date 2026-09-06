-- @menções no chat do pedido estavam mortas de ponta a ponta:
--   - O front chama get_order_chat_mention_targets pra popular o autocomplete
--     do @ (OrderChat.tsx) -- essa RPC nunca existiu em nenhuma migration, a
--     lista sempre veio vazia.
--   - sendOrderMessage manda p_mentioned_user_ids pro RPC send_order_message,
--     mas a function só aceita (p_order_id, p_content) -- o parâmetro é
--     descartado silenciosamente (na real, a chamada quebra por assinatura
--     incompatível), nenhuma mensagem grava quem foi mencionado.
--   - config.toml e discordJobAnnounce.ts já documentam um trigger
--     'notify_discord_chat_mention' que dispararia discord-chat-mention (a
--     function em si funciona, já testada) -- esse trigger nunca foi criado.
-- Fix: cria a RPC de targets, faz send_order_message aceitar e validar
-- p_mentioned_user_ids (só participantes reais do pedido: cliente, booster
-- atribuído ou qualquer admin), grava quem foi mencionado na mensagem, insere
-- a notificação in-app 'chat_mention' e dispara o DM no Discord -- tudo
-- inline na própria RPC (mesmo padrão de net.http_post usado por
-- admin_reassign_booster, migration 20260905140000), já que este projeto não
-- tem nenhum trigger assíncrono funcionando de fato (nem o de order status,
-- que é webhook do dashboard, não SQL).

alter table public.order_messages
  add column mentioned_user_ids uuid[] not null default '{}';

comment on column public.order_messages.mentioned_user_ids is
  'Participantes do pedido (cliente/booster/admin) marcados com @ nesta mensagem -- dispara notificação chat_mention + DM no Discord pra cada um.';

-- Alvos válidos de @menção num pedido: o cliente, o booster atribuído (se
-- houver) e qualquer admin -- nunca o próprio chamador. Mesmo gate de acesso
-- de get_order_chat (admin, ou dono de uma das duas pontas do pedido).
create or replace function public.get_order_chat_mention_targets(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role    public.user_role;
  v_order   public.orders%rowtype;
  v_targets jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into v_targets
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', case
        when p.role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
        when p.role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
        else coalesce(p.username, 'Cliente')
      end,
      'role', p.role,
      'avatar_url', p.avatar_url
    ) as row_data
    from public.profiles p
    left join public.booster_profiles bp on bp.user_id = p.id and p.role = 'booster'::public.user_role
    where p.id <> v_user_id
      and (
        p.id = v_order.customer_id
        or p.id = v_order.assigned_booster_id
        or p.role = 'admin'::public.user_role
      )
  ) targets;

  return jsonb_build_object('success', true, 'targets', v_targets);
end;
$$;

revoke all on function public.get_order_chat_mention_targets(uuid) from public, anon;
grant execute on function public.get_order_chat_mention_targets(uuid) to authenticated;

-- Assinatura antiga (2 args) vira um overload órfão se só trocarmos o corpo
-- com CREATE OR REPLACE -- precisa dropar antes (ver postgres_overload_
-- signature_trap).
drop function if exists public.send_order_message(uuid, text);

create or replace function public.send_order_message(
  p_order_id           uuid,
  p_content            text,
  p_mentioned_user_ids uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_message_id uuid;
  v_valid_mentions uuid[];
  v_mentioned_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', 'Perfil de usuario nao encontrado.');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if not found or not (
    v_role = 'admin'::public.user_role
    or v_order.customer_id = v_user_id
    or v_order.assigned_booster_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'code', 'order_not_found', 'message', 'Pedido nao encontrado.');
  end if;

  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'code', 'chat_unavailable', 'message', 'O chat sera liberado quando um booster for atribuido.');
  end if;

  if v_order.chat_locked and v_role <> 'admin'::public.user_role then
    return jsonb_build_object('success', false, 'code', 'chat_locked', 'message', 'O chat foi bloqueado pela administracao.');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'A mensagem deve ter entre 1 e 4000 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('order_chat_' || replace(p_order_id::text, '-', ''), 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  end if;

  -- Só marca de verdade quem é participante real do pedido (cliente, booster
  -- atribuído ou algum admin) e nunca o próprio remetente -- o payload vem do
  -- cliente, sem essa reconferência um usuário podia alegar ter mencionado
  -- qualquer uuid e gerar notificação/DM falsa pra alguém fora do pedido.
  select coalesce(array_agg(distinct t), '{}')
  into v_valid_mentions
  from unnest(coalesce(p_mentioned_user_ids, '{}')) as t
  where t <> v_user_id
    and (
      t = v_order.customer_id
      or t = v_order.assigned_booster_id
      or exists (select 1 from public.profiles where id = t and role = 'admin'::public.user_role)
    );

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read, mentioned_user_ids)
  values (p_order_id, v_user_id, v_role, v_content, false, v_valid_mentions)
  returning id into v_message_id;

  foreach v_mentioned_id in array v_valid_mentions loop
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_mentioned_id, 'chat_mention', 'Você foi mencionado',
      v_content,
      jsonb_build_object('order_id', p_order_id, 'message_id', v_message_id)
    );

    perform net.http_post(
      url := 'https://yrynfqjxqblrbxxiobty.supabase.co/functions/v1/discord-chat-mention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_functions_anon_key'),
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discord_webhook_secret')
      ),
      body := jsonb_build_object('user_id', v_mentioned_id, 'order_id', p_order_id, 'body', v_content),
      timeout_milliseconds := 10000
    );
  end loop;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$$;

revoke all on function public.send_order_message(uuid, text, uuid[]) from public, anon;
grant execute on function public.send_order_message(uuid, text, uuid[]) to authenticated;
