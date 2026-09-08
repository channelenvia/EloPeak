-- Regressão da migration anterior (20260814090000_order_chat_mentions.sql):
-- ao reescrever send_order_message pra aceitar p_mentioned_user_ids, copiei
-- o corpo da versão anterior a 063_fix_chat_rate_limit_scope_format.sql, que
-- usava 'order_chat:' || p_order_id::text como scope do rate limit. O ':'
-- não bate com ^[a-z0-9_-]{1,64}$ (ver consume_edge_rate_limit, migration
-- 007), então toda mensagem estourava "invalid rate limit configuration" --
-- ninguém conseguia mandar mensagem (nem @mencionar), igual ao bug original
-- que a 063 já tinha corrigido. Reaplica o mesmo formato de scope corrigido.

create or replace function public.send_order_message(p_order_id uuid, p_content text, p_mentioned_user_ids uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_message_id uuid;
  v_sender_name text;
  v_mentioned_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Sessao nao autenticada.');
  end if;

  v_role := public.current_user_role();
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

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read)
  values (p_order_id, v_user_id, v_role, v_content, false)
  returning id into v_message_id;

  select case
    when v_role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
    when v_role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
    else coalesce(p.username, 'Cliente')
  end
  into v_sender_name
  from public.profiles p
  left join public.booster_profiles bp
    on bp.user_id = p.id and v_role = 'booster'::public.user_role
  where p.id = v_user_id;

  for v_mentioned_id in
    select distinct m
    from unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) as m
    where m <> v_user_id
      and (
        m = v_order.customer_id
        or m = v_order.assigned_booster_id
        or exists (select 1 from public.profiles where id = m and role = 'admin'::public.user_role)
      )
  loop
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_mentioned_id,
      'chat_mention',
      'Você foi mencionado no chat',
      coalesce(v_sender_name, 'Alguém') || ' mencionou você no chat do pedido: "' ||
        (case when char_length(v_content) > 140 then left(v_content, 140) || '…' else v_content end) || '"',
      jsonb_build_object('order_id', p_order_id, 'message_id', v_message_id)
    );
  end loop;

  return jsonb_build_object('success', true, 'message_id', v_message_id);
end;
$$;
