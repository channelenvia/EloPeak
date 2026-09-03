-- admin_duo_accounts é uma view legada (migration 007/030) de antes do RPC
-- list_duo_accounts() existir — nem tem a coluna riot_id que a tabela real
-- ganhou depois. 0 referências em src/features e supabase/functions; toda
-- leitura de contas Duo (admin e booster) já passa por list_duo_accounts().
drop view if exists public.admin_duo_accounts;
