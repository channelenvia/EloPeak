-- As colunas de controle da janela de revisao nao possuem SELECT para o papel
-- authenticated. Expor o estado por uma RPC restrita ao admin mantem essa
-- separacao e permite compor os cards da lista sem quebrar a query de orders.
create or replace function public.admin_list_pending_review_states()
returns table (
  order_id uuid,
  admin_review_locked boolean,
  review_release_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  return query
  select o.id, o.admin_review_locked, o.review_release_at
  from public.orders o
  where o.status = 'pending_review';
end;
$$;

revoke all on function public.admin_list_pending_review_states() from public, anon, authenticated;
grant execute on function public.admin_list_pending_review_states() to authenticated;
