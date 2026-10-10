-- M-33: leitura do chat por usuario (order_chat_reads) e janela de historico do booster atual.
-- Mesmas assinaturas: CREATE OR REPLACE (sem overload orfao).
create table if not exists public.order_chat_reads (
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (order_id, user_id)
);
alter table public.order_chat_reads enable row level security;
revoke all on public.order_chat_reads from anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_order_chat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
  v_messages jsonb := '[]'::jsonb;
  v_window_start timestamptz := '-infinity';
  v_last_read timestamptz;
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

  -- Booster novo nao le o historico do anterior: a janela comeca na atribuicao atual (admin e cliente veem tudo).
  if v_role <> 'admin'::public.user_role and v_order.customer_id <> v_user_id then
    select coalesce(max(a.assigned_at), '-infinity') into v_window_start
    from public.order_booster_assignments a
    where a.order_id = p_order_id and a.booster_id = v_user_id and a.unassigned_at is null;
  end if;
  select r.last_read_at into v_last_read from public.order_chat_reads r where r.order_id = p_order_id and r.user_id = v_user_id;

  if v_order.assigned_booster_id is not null then
    select coalesce(jsonb_agg(row_data order by row_data->>'created_at'), '[]'::jsonb)
    into v_messages
    from (
      select jsonb_build_object(
        'id', m.id,
        'order_id', m.order_id,
        'sender_id', m.sender_id,
        'sender_role', m.sender_role,
        'sender_name', case
          when m.sender_role = 'admin'::public.user_role then coalesce(p.username, 'Administrador')
          when m.sender_role = 'booster'::public.user_role then coalesce(bp.display_name, p.username, 'Booster')
          else coalesce(p.username, 'Cliente')
        end,
        'sender_avatar_url', p.avatar_url,
        'content', m.content,
        'created_at', m.created_at,
        'is_read', (m.sender_id = v_user_id or (v_last_read is not null and m.created_at <= v_last_read))
      ) as row_data
      from (
        select om.*
        from public.order_messages om
        where om.order_id = p_order_id
          and om.created_at >= v_window_start
        order by om.created_at desc
        limit 300
      ) m
      join public.profiles p on p.id = m.sender_id
      left join public.booster_profiles bp
        on bp.user_id = m.sender_id
       and m.sender_role = 'booster'::public.user_role
    ) messages;
  end if;

  return jsonb_build_object(
    'success', true,
    'chat_available', v_order.assigned_booster_id is not null,
    'chat_locked', v_order.chat_locked,
    'chat_locked_at', v_order.chat_locked_at,
    'can_send',
      v_order.assigned_booster_id is not null
      and (v_role = 'admin'::public.user_role
           or (not v_order.chat_locked and v_order.status not in ('canceled', 'refunded'))),
    'messages', v_messages
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_order_chat_read(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_order public.orders%rowtype;
begin
  if not public.check_own_write_rate_limit('mark_order_chat_read', 60, 60) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
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

  insert into public.order_chat_reads(order_id, user_id, last_read_at)
  values (p_order_id, v_user_id, now())
  on conflict (order_id, user_id) do update set last_read_at = excluded.last_read_at;

  return jsonb_build_object('success', true);
end;
$function$;

-- Backfill: preserva o que ja estava lido (is_read global) para o cliente e o booster atual de cada pedido.
insert into public.order_chat_reads(order_id, user_id, last_read_at)
select m.order_id, u.user_id, max(m.created_at)
from public.order_messages m
join public.orders o on o.id = m.order_id
cross join lateral (values (o.customer_id), (o.assigned_booster_id)) as u(user_id)
where m.is_read and u.user_id is not null and m.sender_id <> u.user_id
group by m.order_id, u.user_id
on conflict (order_id, user_id) do nothing;
