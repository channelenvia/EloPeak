-- ATENCAO: baseline gerado do banco de producao. NUNCA executar em producao:
-- la deve ser marcado como aplicado com `supabase migration repair`.
set search_path = public, extensions;

-- Baseline (parte 2): objetos fora do schema public que o dump nao cobre.
-- Reflete o banco de producao em 2026-10-08.

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('payout-proofs', 'payout-proofs', false)
on conflict (id) do nothing;

create policy payout_proofs_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payout-proofs' and public.is_admin());
create policy payout_proofs_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'payout-proofs' and public.is_admin())
  with check (bucket_id = 'payout-proofs' and public.is_admin());
create policy payout_proofs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payout-proofs' and public.is_admin());
create policy payout_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payout-proofs' and (public.is_admin() or exists (
    select 1 from public.payout_requests pr
    where pr.proof_url = objects.name and pr.booster_id = auth.uid() and pr.status = 'paid')));

-- Crons que so chamam funcoes SQL.
select cron.schedule('expire-stale-pix-orders', '* * * * *', 'select public.expire_stale_pix_orders();');
select cron.schedule('refresh-booster-performance-segments', '17 * * * *', 'select public.refresh_booster_performance_segments(null);');
select cron.schedule('refresh-top3-boosters', '0 3 15,30 * *', 'select public.refresh_top3_boosters()');
select cron.schedule('expire-stale-booster-suspensions', '*/5 * * * *', 'select public.expire_stale_booster_suspensions();');
select cron.schedule('release-pending-review-orders', '10 seconds', 'select public.release_pending_review_orders();');
