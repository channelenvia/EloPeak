-- Auditoria de contas Duo: encrypted_credentials já teve o SELECT de coluna
-- revogado de authenticated/anon (migration 079) porque list_duo_accounts()
-- nunca expõe login/senha crus pro booster. `notes` (comentário na criação
-- da coluna, 001_initializing.sql: "observações internas -- somente admin")
-- e `created_by` seguem o mesmo padrão de design -- nenhuma versão de
-- list_duo_accounts() (040/056/060/062) jamais incluiu essas duas colunas
-- no branch de booster -- mas, ao contrário de encrypted_credentials, o
-- SELECT de coluna nunca foi revogado pra elas.
--
-- A migration 132 já fechou o vazamento de linha (duo_accounts_read agora só
-- mostra pro booster contas livres ou reservadas por ele mesmo), mas isso
-- não protege as COLUNAS dessas linhas visíveis: um booster aprovado ainda
-- consegue, via REST direto (fora do RPC list_duo_accounts), pedir
-- `select=id,notes,created_by` e ler as observações internas do admin sobre
-- qualquer conta livre do pool ou que ele mesmo tenha reservado. Nenhum fluxo
-- do produto lê essas colunas fora dos RPCs SECURITY DEFINER (que rodam como
-- owner e ignoram GRANT de coluna do chamador), então revogar é seguro.

revoke select ("notes", "created_by") on public.duo_accounts from "authenticated", "anon";

comment on column public.duo_accounts.notes is
  'Observações internas do admin sobre a conta. SELECT direto da coluna é '
  'revogado de authenticated/anon (migration 138) -- leitura só acontece '
  'dentro de list_duo_accounts() (branch admin) e get_duo_account_credentials(), '
  'RPCs SECURITY DEFINER que rodam como owner.';

comment on column public.duo_accounts.created_by is
  'Admin que cadastrou a conta. Mesmo tratamento de notes -- SELECT direto '
  'revogado de authenticated/anon (migration 138), só legível via RPC admin.';
