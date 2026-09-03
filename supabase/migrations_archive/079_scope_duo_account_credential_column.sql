-- duo_accounts_read (migration 056) libera SELECT de toda a linha -- inclusive
-- encrypted_credentials -- de qualquer conta ativa para qualquer booster
-- aprovado, não só a que ele reservou. O valor é ciphertext PGP (a chave só
-- existe em Supabase Vault, nunca chega ao cliente), então isso não é
-- explorável hoje, mas é exposição de coluna desnecessária: nenhum fluxo do
-- produto lê essa coluna via select direto -- acesso real é sempre via
-- get_duo_account_access_token()/resolve_duo_account_access_token() (RPCs
-- SECURITY DEFINER, que leem a coluna internamente independente de GRANT de
-- coluna em `authenticated`). list_duo_accounts() já retorna has_credentials
-- (boolean) em vez do ciphertext -- este é o mesmo tratamento aplicado à
-- própria tabela.
revoke select ("encrypted_credentials") on public.duo_accounts from "authenticated", "anon";

comment on column public.duo_accounts.encrypted_credentials is
  'Ciphertext PGP (pgp_sym_encrypt), chave em Supabase Vault. SELECT direto '
  'da coluna é revogado de authenticated/anon -- leitura só acontece dentro '
  'de RPCs SECURITY DEFINER (get_duo_account_credentials para admin, '
  'get_duo_account_access_token/resolve_duo_account_access_token para o '
  'booster com a conta reservada), que rodam como owner e ignoram GRANTs de '
  'coluna do chamador.';
