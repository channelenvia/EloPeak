-- Regressão da migration 20260814090000_order_chat_mentions.sql: copiei
-- 'avatar_url', coalesce(bp.avatar_url, p.avatar_url) do get_order_chat
-- antigo (034_order_chat_controls.sql), mas booster_profiles nunca teve
-- coluna avatar_url -- só profiles.avatar_url existe (a migration
-- 167_order_chat_read_state.sql já tinha corrigido isso no get_order_chat
-- atual, usando só p.avatar_url). Toda chamada a
-- get_order_chat_mention_targets estourava "column bp.avatar_url does not
-- exist", então o popover de @menção nunca tinha dado pra mostrar.

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
      'avatar_url', p.avatar_url
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
