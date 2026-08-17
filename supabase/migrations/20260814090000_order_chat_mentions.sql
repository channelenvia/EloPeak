-- @mention no chat do pedido: cliente/booster podem marcar a outra parte do
-- pedido ou qualquer admin da plataforma (mesmo offline) -- a marcação vira
-- uma notificação normal (tabela public.notifications, sem trigger/tabela
-- nova) pro usuário mencionado. Substitui o fluxo antigo de "acionar suporte
-- no Discord" (request_order_support/admin_resolve_order_support seguem
-- existindo no banco, só deixam de ser chamados pelo front).

-- Lista de quem pode ser mencionado num pedido: a outra parte (cliente ou
-- booster, o que não for o próprio chamador) + todos os admins da
-- plataforma. Mesma checagem de autorização do get_order_chat/
-- send_order_message (chamador precisa ser admin, cliente ou booster
-- atribuído do pedido).
create or replace function public.get_order_chat_mention_targets(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
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

  select coalesce(jsonb_agg(row_data order by row_data->>'role', row_data->>'name'), '[]'::jsonb)
  into v_targets
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', case
        when p.role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
        when p.role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
        else coalesce(p.username, 'Cliente')
      end,
      'role', p.role,
      'avatar_url', coalesce(bp.avatar_url, p.avatar_url)
    ) as row_data
    from public.profiles p
    left join public.booster_profiles bp
      on bp.user_id = p.id and p.role = 'booster'::public.user_role
    where p.id <> v_user_id
      and (
        p.role = 'admin'::public.user_role
        or p.id = v_order.customer_id
        or p.id = v_order.assigned_booster_id
      )
  ) t;

  return jsonb_build_object('success', true, 'targets', v_targets);
end;
$$;

revoke all on function public.get_order_chat_mention_targets(uuid) from public, anon;
grant execute on function public.get_order_chat_mention_targets(uuid) to authenticated;

-- send_order_message ganha um 3º parâmetro opcional com os ids mencionados.
-- Muda a assinatura da função (uuid, text) -> (uuid, text, uuid[]), então o
-- overload antigo precisa ser derrubado explicitamente -- "create or
-- replace" não substitui uma função com assinatura diferente, só sobrepõe.
drop function if exists public.send_order_message(uuid, text);

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

  if not public.check_own_write_rate_limit('order_chat:' || p_order_id::text, 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  end if;

  insert into public.order_messages(order_id, sender_id, sender_role, content, is_read)
  values (p_order_id, v_user_id, v_role, v_content, false)
  returning id into v_message_id;

  -- Ids mencionados são sempre revalidados aqui (nunca confiar na lista que
  -- veio do cliente) -- só viram notificação se forem de fato a outra parte
  -- do pedido ou algum admin da plataforma.
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

revoke all on function public.send_order_message(uuid, text, uuid[]) from public, anon;
grant execute on function public.send_order_message(uuid, text, uuid[]) to authenticated;
