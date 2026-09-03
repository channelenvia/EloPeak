-- Permite que admins organizem os repasses dos boosters pela tela financeira.
-- Boosters continuam podendo apenas ler os próprios registros pela policy
-- payout_records_read existente.

create policy "payout_records_admin_update"
on public.payout_records
for update
using (public.is_admin())
with check (public.is_admin());
