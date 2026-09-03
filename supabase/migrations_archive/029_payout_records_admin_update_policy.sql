-- Garante que admins possam atualizar o estado dos repasses dos boosters.
-- A versão anterior colidiu com outra migration 026 em alguns ambientes.

drop policy if exists "payout_records_admin_update" on public.payout_records;

create policy "payout_records_admin_update"
on public.payout_records
for update
using (public.is_admin())
with check (public.is_admin());
