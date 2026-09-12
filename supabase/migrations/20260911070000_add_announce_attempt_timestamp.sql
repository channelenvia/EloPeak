-- Bug (achado em auditoria, Discord): announce-stale-awaiting-assignment-jobs
-- decide se um pedido está "sem anúncio confirmado" comparando updated_at
-- (quando o pedido ENTROU em awaiting_assignment) contra uma janela de
-- graça de 2min -- não quando a TENTATIVA de envio (discord-order-channel)
-- de fato começou. Se a chamada ao Discord demorar mais que 2min (rate
-- limit, instabilidade), o cron reenvia (DM/anúncio duplicado) antes da
-- tentativa original terminar e marcar awaiting_assignment_announced_at.
--
-- Fix: nova coluna, marcada pelo emissor IMEDIATAMENTE ANTES de chamar a
-- API do Discord (não depois) -- o cron passa a contar a janela de graça a
-- partir dela quando presente, caindo de volta em updated_at só quando
-- nenhuma tentativa ainda foi registrada (comportamento de hoje).
alter table public.orders
  add column if not exists awaiting_assignment_announce_attempted_at timestamptz;
