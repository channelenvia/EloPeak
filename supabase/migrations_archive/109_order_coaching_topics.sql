-- Checklist de tópicos por pedido de coaching -- cliente e booster vão
-- adicionando itens e marcando check conforme avançam na sessão, registrando
-- o passo a passo do coaching. Mesma postura de segurança do chat
-- (order_messages/send_order_message): leitura via RLS direta, escrita só
-- via function security definer (identidade/role nunca vêm do client),
-- rate-limited.

create table public.order_coaching_topics (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  content text not null,
  is_done boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_by_role public.user_role not null,
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index order_coaching_topics_order_idx on public.order_coaching_topics(order_id, created_at);

alter table public.order_coaching_topics enable row level security;

create policy "order_coaching_topics_read" on public.order_coaching_topics for select using (
  public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.id = order_coaching_topics.order_id
      and (o.customer_id = auth.uid() or o.assigned_booster_id = auth.uid())
  )
);

revoke all on public.order_coaching_topics from public, anon;
revoke insert, update, delete on public.order_coaching_topics from authenticated;
grant select on public.order_coaching_topics to authenticated;

create or replace function public.add_order_coaching_topic(p_order_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_topic_id uuid;
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

  if v_order.service_type <> 'coaching' then
    return jsonb_build_object('success', false, 'code', 'not_coaching_order', 'message', 'Este pedido nao e de coaching.');
  end if;

  if v_order.assigned_booster_id is null or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'code', 'topics_unavailable', 'message', 'Os topicos ainda nao estao disponiveis para este pedido.');
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 200 then
    return jsonb_build_object('success', false, 'code', 'invalid_content', 'message', 'O topico deve ter entre 1 e 200 caracteres.');
  end if;

  if not public.check_own_write_rate_limit('coaching_topic_' || replace(p_order_id::text, '-', ''), 20, 60) then
    return jsonb_build_object('success', false, 'code', 'rate_limited', 'message', 'Muitos topicos em pouco tempo. Aguarde um minuto.');
  end if;

  insert into public.order_coaching_topics(order_id, content, created_by, created_by_role)
  values (p_order_id, v_content, v_user_id, v_role)
  returning id into v_topic_id;

  return jsonb_build_object('success', true, 'topic_id', v_topic_id);
end;
$$;

create or replace function public.set_order_coaching_topic_done(p_order_id uuid, p_topic_id uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
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

  if v_order.service_type <> 'coaching' then
    return jsonb_build_object('success', false, 'code', 'not_coaching_order', 'message', 'Este pedido nao e de coaching.');
  end if;

  if v_order.assigned_booster_id is null or v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'code', 'topics_unavailable', 'message', 'Os topicos ainda nao estao disponiveis para este pedido.');
  end if;

  update public.order_coaching_topics
  set is_done = p_done,
      completed_by = case when p_done then v_user_id else null end,
      completed_at = case when p_done then now() else null end
  where id = p_topic_id and order_id = p_order_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'topic_not_found', 'message', 'Topico nao encontrado.');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.add_order_coaching_topic(uuid, text) from public, anon;
revoke all on function public.set_order_coaching_topic_done(uuid, uuid, boolean) from public, anon;
grant execute on function public.add_order_coaching_topic(uuid, text) to authenticated;
grant execute on function public.set_order_coaching_topic_done(uuid, uuid, boolean) to authenticated;
