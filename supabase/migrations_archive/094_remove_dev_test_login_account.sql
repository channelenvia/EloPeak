-- Remove o backdoor de autenticação `dev-test-login` (edge function já
-- apagada do repo) e a conta de teste fixa que ele usava
-- (dev-agent-test@eloboost.local). A function gerava magic link via Admin
-- API pra essa conta usando só um secret estático como trava — sem rate
-- limit, sem gate de DENO_ENV, sem expiração. Achado CRÍTICO de auditoria de
-- segurança: se o secret vazasse, era login completo (potencialmente admin,
-- dependendo do role atribuído manualmente a essa conta) sem passar pelo
-- Discord OAuth.
--
-- `profiles.id` referencia `auth.users(id) on delete cascade` (001), então
-- apagar o auth.users já limpa profiles. Não force cascade em orders/reviews/
-- etc. (FK sem cascade pra customer_id/assigned_booster_id) -- se essa conta
-- tiver qualquer pedido de verdade associado, o delete falha em vez de
-- apagar dados silenciosamente, o que é o comportamento certo aqui (não é
-- pra existir pedido nenhum nessa conta, mas não assuma).
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'dev-agent-test@eloboost.local';

  if v_user_id is not null then
    delete from auth.users where id = v_user_id;
    raise notice 'Removed dev-test-login account %', v_user_id;
  else
    raise notice 'dev-agent-test@eloboost.local not found — nothing to remove';
  end if;
end $$;
