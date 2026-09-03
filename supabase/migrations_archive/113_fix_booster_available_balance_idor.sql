-- booster_available_balance(p_booster_id) é SECURITY DEFINER (contorna a RLS
-- de booster_ledger_entries, que só libera `booster_id = auth.uid()`) e está
-- liberada pra `authenticated` -- mas, diferente da função irmã
-- booster_payout_totals (mesma migration 081), nunca checou se quem chamou é
-- o próprio booster ou um admin. Qualquer usuário logado conseguia ler o
-- saldo real de QUALQUER booster só passando o uuid dele
-- (`supabase.rpc('booster_available_balance', { p_booster_id: '<outro>' })`).
--
-- Mesma trava de booster_payout_totals: fora do dono/admin, devolve null em
-- vez de erro -- é só leitura de saldo, não uma operação que precise negar
-- explicitamente (e mantém o tipo de retorno numeric, sem quebrar quem já
-- consome como número).
create or replace function public.booster_available_balance(p_booster_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_booster_id or public.is_admin()
      then coalesce((select sum(amount) from public.booster_ledger_entries where booster_id = p_booster_id), 0)
    else null
  end;
$$;
