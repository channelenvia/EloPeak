-- Achado do code review desta sessão (F10): onboard_booster e
-- update_booster_professional_profile ainda tinham EXECUTE liberado pra anon
-- (grant default de criação nunca revogado) -- ambas dependem de auth.uid()
-- internamente, então uma chamada anon já falha na prática, mas fica
-- inconsistente com o resto da superfície de RPCs self-service já endurecida
-- (mesma classe de bug de grant hygiene corrigida em 20260905190000/200000).
revoke all on function public.onboard_booster(
  text, text, jsonb, text, integer, integer, text, text, text[]
) from anon;

revoke all on function public.update_booster_professional_profile(
  text, text, text, text, boolean, text[], integer, integer
) from anon;
