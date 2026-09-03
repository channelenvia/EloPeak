-- Revisão de segurança confirmou ao vivo no banco (has_table_privilege /
-- has_column_privilege) que o role `anon` ainda tinha privilégios herdados de
-- PUBLIC nunca revogados explicitamente em tabelas sensíveis: INSERT/UPDATE
-- em orders, SELECT (inclusive em encrypted_credentials) e UPDATE em
-- duo_accounts, SELECT em payments/payout_requests/booster_ledger_entries.
--
-- Hoje isso NÃO é explorável -- toda policy de RLS relevante exige
-- is_admin() ou auth.uid() = <dono>, que são sempre falsos pra `anon` (sem
-- sessão). Mas é uma dependência total em RLS sem defesa em profundidade:
-- qualquer regressão futura (uma policy nova com `using (true)` por engano,
-- um `disable row level security` acidental numa migration, ou um role com
-- BYPASSRLS) expõe na hora dados de pagamento/credenciais a requisições sem
-- autenticação nenhuma. As migrations 007/036 já fizeram esse "revoke +
-- grant coluna a coluna" pra `authenticated`, mas deixaram `anon` de fora em
-- várias tabelas -- esta migration fecha essa lacuna.
--
-- Só revoga de `anon`; nenhum privilégio de `authenticated` é alterado.

revoke all on public.orders from anon;
revoke all on public.duo_accounts from anon;
revoke all on public.payments from anon;
revoke all on public.payout_requests from anon;
revoke all on public.booster_ledger_entries from anon;
