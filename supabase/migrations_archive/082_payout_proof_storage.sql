-- Bucket privado para comprovantes de pagamento de saque (payout_requests).
-- Primeiro uso de Supabase Storage neste projeto -- não havia nenhum bucket
-- antes. Upload é feito pelo admin direto do browser (client Supabase,
-- protegido pelas policies abaixo); admin_mark_payout_paid (migration 081)
-- só grava o caminho do objeto em payout_requests.proof_url, nunca lida com
-- o arquivo em si.

insert into storage.buckets (id, name, public)
values ('payout-proofs', 'payout-proofs', false)
on conflict (id) do nothing;

create policy "payout_proofs_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payout-proofs' and public.is_admin());

create policy "payout_proofs_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'payout-proofs' and public.is_admin())
  with check (bucket_id = 'payout-proofs' and public.is_admin());

create policy "payout_proofs_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payout-proofs' and public.is_admin());

-- Leitura: admin sempre; o booster dono da solicitação só depois de paga
-- (proof_url aponta pra este objeto) -- não pode ver comprovantes de
-- outros boosters nem antes do pagamento.
create policy "payout_proofs_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-proofs' and (
      public.is_admin()
      or exists (
        select 1 from public.payout_requests pr
        where pr.proof_url = storage.objects.name
          and pr.booster_id = auth.uid()
          and pr.status = 'paid'
      )
    )
  );
