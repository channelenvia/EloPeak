-- booster_payout_summary (migration 009) calcula saldo a partir de
-- payout_records.status, que nada mais atualiza desde a migration 081
-- (ledger + payout_requests substituíram esse fluxo). A função ficou morta
-- no frontend (nenhum caller em src/), mas continuava com
-- `grant execute ... to authenticated` -- qualquer booster logado ainda
-- conseguia chamá-la direto via supabase.rpc(...) e receber um saldo
-- enganoso (soma de todo o histórico, nunca desconta saques, já que
-- payout_records.status trava em 'pending' pra sempre).
--
-- Revoga o execute em vez de dropar a função -- evita qualquer risco de
-- dependência não mapeada, mas fecha a superfície exposta.

revoke execute on function public.booster_payout_summary(uuid) from authenticated;
