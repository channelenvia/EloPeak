-- Admin ganha exclusão real de conta Duo (bloqueada enquanto reservada —
-- precisa liberar antes). Boosters passam a ver o riot_id (não é credencial,
-- é o nick público da conta) já que o "identificador" manual deixou de
-- existir na tela do admin e o riot_id é agora o único identificador.
create or replace function public.delete_duo_account(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reserved_by uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select reserved_by into v_reserved_by from public.duo_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;
  if v_reserved_by is not null then
    return jsonb_build_object('success', false, 'error', 'account_reserved');
  end if;

  delete from public.duo_accounts where id = p_account_id;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), public.current_user_role(), 'duo_account.deleted', 'duo_account', p_account_id::text);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_accounts jsonb;
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'game_id', game_id, 'label', label, 'riot_id', riot_id,
      'current_rank', current_rank, 'notes', notes, 'is_active', is_active,
      'created_by', created_by, 'created_at', created_at, 'updated_at', updated_at,
      'has_credentials', encrypted_credentials is not null,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id, 'reserved_at', reserved_at
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts;
  else
    select exists (
      select 1 from public.booster_profiles
      where user_id = auth.uid() and status = 'approved'
    ) into v_is_booster;

    if not v_is_booster then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

    -- Só contas livres ou já reservadas pelo próprio booster — uma conta
    -- reservada por outro booster desaparece da lista dele.
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'riot_id', riot_id, 'current_rank', current_rank, 'is_active', is_active,
      'reserved_by', reserved_by, 'reserved_order_id', reserved_order_id
    ) order by created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts
    where is_active = true
      and encrypted_credentials is not null
      and public.duo_account_rank_is_valid(current_rank)
      and (reserved_by is null or reserved_by = auth.uid());
  end if;

  return jsonb_build_object('success', true, 'accounts', v_accounts);
end;
$$;

grant execute on function public.delete_duo_account(uuid) to authenticated;
