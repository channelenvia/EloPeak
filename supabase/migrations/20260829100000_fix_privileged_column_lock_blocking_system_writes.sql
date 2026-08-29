-- CRÍTICO -- achado pelo /code-review: o trigger de segurança adicionado em
-- 20260829060000 (bloqueia não-admin de mudar colunas privilegiadas de
-- booster_profiles) usava só `is_admin()` -- que checa auth.uid() da SESSÃO
-- que originou a escrita. Isso quebra TRÊS fluxos legítimos e essenciais da
-- plataforma, onde quem "aciona" a escrita nunca é um admin:
--
--   1. Booster confirma conclusão do próprio pedido (confirm_order_completion,
--      fluxo mais comum da plataforma) -> orders.status vira 'completed' ->
--      dispara trg_fn_order_completed_booster_stats (trigger AFTER UPDATE em
--      orders, migration 136) -> UPDATE booster_profiles SET total_completed
--      = total_completed+1, total_earnings = total_earnings+... -> a sessão
--      é a do BOOSTER, não admin -> is_admin() = false -> trigger novo
--      bloqueia -> conclusão de pedido inteira falha com exceção.
--   2. Cliente envia/edita/apaga uma review -> dispara
--      reviews_refresh_booster_rating (trigger AFTER em reviews, migration
--      003) -> chama refresh_booster_rating() -> UPDATE booster_profiles SET
--      rating=..., rating_count=... -> sessão é do CLIENTE -> mesma exceção
--      -> review inteira falha.
--   3. Job do pg_cron (2x/mês) chama refresh_top3_boosters() -> UPDATE
--      booster_profiles SET is_top3=... -> não roda em NENHUMA sessão de
--      usuário (auth.uid() é null) -> is_admin() = false -> mesma exceção ->
--      recálculo de top3 falha silenciosamente pra sempre.
--
-- Ou seja: desde que 20260829060000 foi aplicada, conclusão de pedido,
-- reviews e o recálculo de top3 estavam quebrados. Fix: complementa
-- is_admin() com `session_user <> current_user` -- verdadeiro exatamente
-- quando estamos DENTRO da execução de uma função SECURITY DEFINER (que
-- troca current_user pro dono da função, mas mantém session_user), que é
-- justamente o padrão usado por TODA escrita legítima deste projeto
-- (triggers e RPCs). Uma chamada direta do cliente via PostgREST
-- (`supabase.from('booster_profiles').update(...)`) nunca passa por uma
-- SECURITY DEFINER function -- roda com session_user = current_user =
-- authenticated/anon -- então o ataque original que esse trigger foi criado
-- pra fechar continua bloqueado.
create or replace function public.prevent_non_admin_booster_privileged_column_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or session_user <> current_user then
    return new;
  end if;

  if new.is_top3 is distinct from old.is_top3
     or new.total_earnings is distinct from old.total_earnings
     or new.rating is distinct from old.rating
     or new.rating_count is distinct from old.rating_count
     or new.blocked_until is distinct from old.blocked_until
     or new.suspended_until is distinct from old.suspended_until
     or new.verified_at is distinct from old.verified_at
     or new.total_completed is distinct from old.total_completed
  then
    raise exception 'only admins can change privileged booster_profiles columns';
  end if;

  return new;
end;
$$;
