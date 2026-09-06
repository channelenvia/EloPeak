-- CRITICAL, achado no code review desta sessão (B5): expel_booster tinha
-- EXECUTE liberado pra `authenticated` e nenhuma checagem de autorização
-- própria (nem is_admin(), nem confia em auth.uid() -- usa p_actor_id, um
-- parâmetro vindo do chamador). A edge function expel-booster já valida
-- profile.role='admin' antes de chamar essa RPC via service_role (client
-- correto, p_actor_id = user.id verificado) -- mas com EXECUTE liberado pra
-- authenticated, qualquer usuário logado podia chamar
-- supabase.rpc('expel_booster', {...}) direto do navegador, pulando esse
-- gate inteiro, e expulsar qualquer booster (derruba status + rebaixa
-- profiles.role pra customer).
--
-- Fix: revoga authenticated/anon, deixa só service_role (mesmo padrão de
-- apply_order_drop e outras RPCs cuja única porta de entrada legítima é uma
-- edge function que já fez seu próprio gate -- adicionar is_admin() aqui
-- dentro quebraria essa chamada legítima, já que auth.uid() é null no
-- contexto service_role).
revoke all on function public.expel_booster(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.expel_booster(uuid, text, uuid) to service_role;
