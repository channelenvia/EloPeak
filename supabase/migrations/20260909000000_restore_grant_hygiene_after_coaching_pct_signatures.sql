-- Code review da migration anterior (20260908090000) apontou que ela dropou
-- e recriou apply_order_drop/admin_drop_order/resolve_drop_request/
-- admin_reassign_booster com assinatura nova (parâmetro extra) sem
-- reemitir os revoke/grant que toda sibling RPC de admin já tinha --
-- verificado direto no banco (has_function_privilege): authenticated/
-- service_role já executam as 4 (Postgres concede EXECUTE a PUBLIC por
-- padrão na criação, então não quebrou nada pra eles), mas 'anon' também
-- ficou com EXECUTE nas 4 -- diferente de toda RPC de admin/drop irmã, que
-- sempre revoga anon explicitamente. is_admin()/auth.uid() interno já
-- bloqueia qualquer uso indevido (anon nunca teria auth.uid()), então não é
-- uma brecha de dado -- mas é uma regressão de higiene em relação ao padrão
-- do projeto, então restaura aqui.
revoke all on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role, numeric) from public, anon, authenticated;
grant execute on function public.apply_order_drop(uuid, text, uuid, text, public.drop_requester_role, numeric) to service_role;

revoke all on function public.admin_drop_order(uuid, text, numeric) from public, anon;
grant execute on function public.admin_drop_order(uuid, text, numeric) to authenticated;

revoke all on function public.resolve_drop_request(uuid, boolean, text, numeric) from public, anon;
grant execute on function public.resolve_drop_request(uuid, boolean, text, numeric) to authenticated;

revoke all on function public.admin_reassign_booster(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_reassign_booster(uuid, uuid, text, numeric) to authenticated;
