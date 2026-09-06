-- Achado do code review desta sessão (B1): duo_account_events e
-- booster_profile_events tinham a única policy de SELECT como
-- `qual = true` combinada com grant de SELECT pra `anon` -- qualquer
-- request não autenticada em GET /rest/v1/duo_account_events ou
-- /booster_profile_events lia o histórico completo de reserva/liberação de
-- conta duo e de mudança de perfil de booster, sem login nenhum.

-- booster_profile_events: só o próprio booster (via booster_id) ou admin.
drop policy if exists booster_profile_events_read on public.booster_profile_events;
create policy booster_profile_events_read on public.booster_profile_events
  for select
  using (booster_id = auth.uid() or public.is_admin());
revoke select on public.booster_profile_events from anon;

-- duo_account_events: não tem coluna de dono direta -- junta com
-- duo_accounts pra restringir a quem tem (ou tinha) a conta reservada, ou
-- admin. Mesmo critério de "estado atual" que duo_accounts_read já usa.
drop policy if exists duo_account_events_read on public.duo_account_events;
create policy duo_account_events_read on public.duo_account_events
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.duo_accounts da
      where da.id = duo_account_events.account_id and da.reserved_by = auth.uid()
    )
  );
revoke select on public.duo_account_events from anon;

-- Grant hygiene: admin_drop_order/delete_duo_account/update_duo_account_rank
-- ainda tinham o grant PUBLIC/anon padrão que toda RPC de admin/duo-account
-- já teve revogado (admin_adjust_booster_balance, admin_release_duo_account,
-- save_duo_account, set_duo_account_active, etc.) -- is_admin()/checagem de
-- dono interna já bloqueia uso indevido, mas fica inconsistente com as
-- irmãs já endurecidas.
revoke all on function public.admin_drop_order(uuid, text) from public, anon;
revoke all on function public.delete_duo_account(uuid) from public, anon;
revoke all on function public.update_duo_account_rank(uuid, text, text) from public, anon;
