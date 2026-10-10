-- N-5: a janela do chat (booster novo nao le o historico do anterior) valia so no RPC get_order_chat;
-- o SELECT direto (REST/Realtime) em order_messages devolvia tudo ao booster atual. A policy passa a usar a mesma regra.
create or replace function public.can_read_order_message(p_order_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.assigned_booster_id is not null
      and (
        o.customer_id = (select auth.uid())
        or (
          o.assigned_booster_id = (select auth.uid())
          and p_created_at >= coalesce((
            select max(a.assigned_at)
            from public.order_booster_assignments a
            where a.order_id = o.id and a.booster_id = (select auth.uid()) and a.unassigned_at is null
          ), '-infinity'::timestamptz)
        )
        or public.is_admin()
      )
  );
$$;

revoke execute on function public.can_read_order_message(uuid, timestamptz) from public, anon;
grant execute on function public.can_read_order_message(uuid, timestamptz) to authenticated, service_role;

drop policy if exists order_messages_read on public.order_messages;
create policy order_messages_read on public.order_messages for select to authenticated
  using (public.can_read_order_message(order_id, created_at));
