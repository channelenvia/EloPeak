-- Bug: list_duo_accounts() (booster branch) parou de filtrar por
-- duo_account_rank_is_valid(current_rank) -- migrations_archive/056 e 062
-- tinham esse filtro, mas migrations_archive/148 (histórico de reservas)
-- reescreveu a função pra incluir reserved_by_name e derrubou o filtro sem
-- nenhuma nota no comentário da migration (não parece intencional -- a
-- própria migrations_archive/20260906140000, que auditou justamente esse
-- tipo de inconsistência entre reserve_duo_account/set_duo_account_active/
-- save_duo_account/update_duo_account_rank, não listou list_duo_accounts
-- entre as funções que já exigiam duo_account_rank_is_valid).
--
-- reserve_duo_account continua rejeitando rank inválido (seu UPDATE
-- condicional já tem "and public.duo_account_rank_is_valid(current_rank)"),
-- então o resultado prático é uma conta aparecer selecionável pro booster na
-- tela e falhar com "account_unavailable" ao tentar reservar -- confuso, sem
-- explicar o motivo real (rank fora do intervalo suportado).
--
-- Fix: devolve o filtro no branch de booster. Também devolve 'riot_id' no
-- jsonb_build_object do booster -- migrations_archive/062 introduziu esse
-- campo ali de propósito ("boosters passam a ver o riot_id, já que o
-- identificador manual deixou de existir"), mas 148 também o perdeu na
-- reescrita; BoosterVisibleDuoAccount (src/api/duoAccounts/types.ts) e
-- Accounts.tsx (`a.riot_id ?? a.label`) já esperam esse campo -- hoje só não
-- quebra visivelmente porque o formulário atual sempre grava label = riot_id.
-- Resto da função idêntico à versão vigente (migrations_archive/148).
create or replace function public.list_duo_accounts()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_accounts jsonb;
  v_is_booster boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'game_id', d.game_id, 'label', d.label,
      'current_rank', d.current_rank, 'notes', d.notes, 'is_active', d.is_active,
      'created_by', d.created_by, 'created_at', d.created_at, 'updated_at', d.updated_at,
      'has_credentials', d.encrypted_credentials is not null,
      'reserved_by', d.reserved_by, 'reserved_order_id', d.reserved_order_id, 'reserved_at', d.reserved_at,
      'reserved_by_name', bp.display_name
    ) order by d.created_at desc), '[]'::jsonb)
    into v_accounts
    from public.duo_accounts d
    left join public.booster_profiles bp on bp.user_id = d.reserved_by;
  else
    select exists (
      select 1 from public.booster_profiles
      where user_id = auth.uid() and status = 'approved'
    ) into v_is_booster;

    if not v_is_booster then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

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
