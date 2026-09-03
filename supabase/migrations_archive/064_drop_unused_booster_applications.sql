-- booster_applications é schema legado: 0 linhas, 0 referências no código
-- frontend e em nenhuma function/trigger SQL. O fluxo real de candidatura de
-- booster (BoosterApplicationForm.tsx -> RPC onboard_booster) grava direto em
-- booster_profiles com status='pending' — a fila de revisão do admin já lê
-- daí. Confirmado com o usuário antes de derrubar (operação irreversível).
drop table if exists public.booster_applications;
