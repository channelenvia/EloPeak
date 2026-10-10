-- N-3: a UI promete "nossa equipe confere antes de iniciar" para elo declarado pelo cliente, mas o pedido seguia o fluxo
-- normal (janela de 2 min e liberacao automatica). Agora todo pedido client_declared que entra em pending_review
-- (qualquer caminho: PIX, cartao, liberacao apos credenciais) nasce travado e avisa os admins; a liberacao e manual.
create or replace function public.hold_declared_rank_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_review'
     and old.status is distinct from 'pending_review'
     and new.rank_source = 'client_declared'
     and new.assigned_booster_id is null then
    new.admin_review_locked := true;
    insert into public.notifications(user_id, type, title, body, data)
    select id, 'order_declared_rank_review', 'Pedido com elo declarado aguardando conferência',
           'Pedido ' || new.id::text || ' foi pago com elo informado pelo cliente (a Riot não tem o rank). Confira a verificação do sistema e libere manualmente.',
           jsonb_build_object('order_id', new.id)
    from public.profiles where role = 'admin';
  end if;
  return new;
end;
$$;

revoke execute on function public.hold_declared_rank_order() from public, anon, authenticated;

drop trigger if exists trg_hold_declared_rank_order on public.orders;
create trigger trg_hold_declared_rank_order
  before update of status on public.orders
  for each row execute function public.hold_declared_rank_order();
