-- Endpoint mínimo pra manter duo_accounts.current_rank atualizado sozinho:
-- quando uma conta é liberada ao fim de um pedido Duo Boost (trigger
-- trg_fn_release_duo_account_on_order_end, migration 056), o cliente
-- (booster ou admin, o que estiver com a lista de contas Duo aberta)
-- detecta a liberação e chama isso após reconsultar o rank atual na Riot
-- (riot-account-rank) -- ver useDuoAccountAutoRefresh no frontend. Não
-- reaproveita save_duo_account porque aquele exige login/senha (só faz
-- sentido no fluxo de criar/editar conta pelo admin).
create or replace function public.update_duo_account_rank(
  p_account_id uuid,
  p_tier       text,
  p_division   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (
    public.is_admin()
    or exists (select 1 from public.booster_profiles where user_id = auth.uid() and status = 'approved')
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division),
      updated_at = now()
  where id = p_account_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_duo_account_rank(uuid, text, text) to authenticated;
