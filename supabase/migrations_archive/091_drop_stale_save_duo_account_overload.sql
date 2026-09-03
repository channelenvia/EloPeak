-- save_duo_account tinha DOIS overloads coexistindo no banco: a versão
-- original de 8 parâmetros (migration 040, sem p_riot_id) e a atual de 9
-- parâmetros (migration 060, com p_riot_id). `create or replace function`
-- com uma lista de parâmetros diferente cria um overload NOVO em vez de
-- substituir o antigo -- a versão de 8 parâmetros nunca foi dropada
-- explicitamente, então ficou pra trás, viva, no banco.
--
-- Duas funções com o mesmo nome confundem a resolução de overload do
-- PostgREST (erro clássico PGRST203: "Could not choose the best candidate
-- function") -- é isso que quebrava o admin tentando adicionar/editar uma
-- conta Duo. Remove só a versão obsoleta; a de 9 parâmetros (com
-- p_riot_id) é a única correta e continua intacta.
drop function if exists public.save_duo_account(
  p_account_id uuid,
  p_label text,
  p_tier text,
  p_division text,
  p_notes text,
  p_is_active boolean,
  p_login text,
  p_password text
);
