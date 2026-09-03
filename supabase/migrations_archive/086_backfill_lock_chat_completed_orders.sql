-- trg_lock_chat_on_order_completed (migration 085) só passou a existir
-- depois de aplicada -- pedidos que já estavam 'completed' antes disso nunca
-- passaram pela transição de status que dispara o trigger, então o chat
-- deles ficou destravado pra sempre. Backfill único: aplica o mesmo estado
-- final que o trigger teria produzido, pros pedidos já concluídos.
update public.orders
set chat_locked = true,
    chat_locked_at = coalesce(chat_locked_at, updated_at, now())
where status = 'completed'
  and not chat_locked;
