-- Ao concluir um pedido, o chat trava automaticamente (vira só registro
-- salvo) -- antes disso chat_locked só mudava por ação manual do admin
-- (set_order_chat_lock), então um pedido concluído continuava com o chat
-- aberto pra novas mensagens indefinidamente.

create or replace function public.trg_fn_lock_chat_on_order_completed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status and not new.chat_locked then
    update public.orders
    set chat_locked = true,
        chat_locked_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_lock_chat_on_order_completed
  after update of status on public.orders
  for each row execute function public.trg_fn_lock_chat_on_order_completed();
