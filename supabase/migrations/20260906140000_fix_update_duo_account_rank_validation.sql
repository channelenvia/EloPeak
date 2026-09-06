-- Bug (HIGH): update_duo_account_rank valida tier/division mais frouxo que
-- duo_account_rank_is_valid (aceita master/grandmaster/challenger e division
-- nula pra qualquer tier), mas reserve_duo_account/set_duo_account_active/
-- save_duo_account todos exigem duo_account_rank_is_valid, que rejeita esses
-- tiers e exige division não-nula. Chamar esta RPC pode gravar um
-- current_rank que trava a conta duo de nunca mais ser reservada/ativada.
--
-- Fix: validar contra o mesmo público.duo_account_rank_is_valid usado pelas
-- RPCs irmãs, em vez de uma allow-list solta e divergente.
create or replace function public.update_duo_account_rank(p_account_id uuid, p_tier text, p_division text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account record;
begin
  if not public.duo_account_rank_is_valid(jsonb_build_object('tier', p_tier, 'division', p_division)) then
    return jsonb_build_object('success', false, 'error', 'invalid_rank');
  end if;

  select id, reserved_by, last_released_by, last_released_at
  into v_account
  from public.duo_accounts
  where id = p_account_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_found');
  end if;

  if not (
    public.is_admin()
    or v_account.reserved_by = auth.uid()
    or (
      v_account.reserved_by is null
      and v_account.last_released_by = auth.uid()
      and v_account.last_released_at > now() - interval '2 minutes'
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.duo_accounts
  set current_rank = jsonb_build_object('tier', p_tier, 'division', p_division),
      updated_at = now()
  where id = p_account_id;

  return jsonb_build_object('success', true);
end;
$function$;
