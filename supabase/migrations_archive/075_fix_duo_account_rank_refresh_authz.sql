-- Corrige update_duo_account_rank (migration 072), sinalizado por revisão de
-- segurança: qualquer booster aprovado podia sobrescrever o rank de
-- QUALQUER conta Duo (IDOR -- sem checar se a conta tinha relação com o
-- chamador) com tier/division arbitrários (sem validar contra os valores
-- reais do enum).
--
-- Fix: (1) valida p_tier/p_division contra os valores reais de rank;
-- (2) restringe a escrita a contas que o chamador pode legitimamente tocar
-- -- admin sempre pode; um booster só pode atualizar uma conta que esteja
-- livre agora (reserved_by is null) ou reservada por ele mesmo. Isso cobre
-- o caso de uso real (useDuoAccountAutoRefresh dispara logo após a conta
-- ser liberada, quando reserved_by já é null) sem abrir a escrita pra
-- qualquer conta do sistema.

create or replace function public.update_duo_account_rank(
  p_account_id uuid,
  p_tier       text,
  p_division   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_tier not in ('iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger') then
    return jsonb_build_object('success', false, 'error', 'invalid_tier');
  end if;
  if p_division is not null and p_division not in ('I','II','III','IV') then
    return jsonb_build_object('success', false, 'error', 'invalid_division');
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1 from public.booster_profiles bp
      join public.duo_accounts da on da.id = p_account_id
      where bp.user_id = auth.uid()
        and bp.status = 'approved'
        and (da.reserved_by is null or da.reserved_by = auth.uid())
    )
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
