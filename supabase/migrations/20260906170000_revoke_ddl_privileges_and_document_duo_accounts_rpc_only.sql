-- Bug (LOW, defesa em profundidade): anon/authenticated ainda têm
-- TRUNCATE/TRIGGER/REFERENCES (grant padrão do Supabase em blocos) mesmo em
-- tabelas financeiramente sensíveis como refunds/audit_logs -- privilégios
-- que RLS não cobre de jeito nenhum. Não alcançável via PostgREST hoje, mas
-- se algum caminho raw-Postgres algum dia rodar como anon/authenticated,
-- poderia truncar a tabela direto.
--
-- Fix: revogar esses três privilégios de anon/authenticated em todas as
-- tabelas do schema public. SELECT/INSERT/UPDATE/DELETE continuam intactos
-- (controlados por RLS/grants por coluna existentes).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Bug (LOW): as policies de duo_accounts (duo_accounts_read/_admin_*)
-- referenciam colunas que authenticated nem tem grant pra ver -- tráfego
-- real passa só pelas RPCs list_duo_accounts()/save_duo_account(). As
-- policies não são exploráveis (nenhum grant de tabela libera SELECT direto
-- pra authenticated/anon) mas são fáceis de confundir com acesso direto
-- liberado numa leitura futura.
--
-- Fix: documentar explicitamente que a tabela é RPC-only por design, em vez
-- de derrubar as policies (mantê-las como cinto-e-suspensório caso um grant
-- de coluna seja adicionado no futuro sem que alguém lembre de recriar RLS).
comment on table public.duo_accounts is
  'Contas duo (credenciais/rank/reserva). Acesso de authenticated/anon é '
  'RPC-only por design -- list_duo_accounts()/save_duo_account()/'
  'reserve_duo_account() etc, todas SECURITY DEFINER. Não há grant de SELECT '
  'de tabela nem por coluna pra authenticated/anon; as policies RLS '
  '(duo_accounts_read/_admin_insert/update/delete) existem como defesa em '
  'profundidade caso um grant de coluna seja adicionado no futuro.';
