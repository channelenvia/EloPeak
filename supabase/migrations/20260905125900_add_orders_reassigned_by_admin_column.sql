-- Achado do code-review desta sessão: orders.reassigned_by_admin já existia
-- ao vivo no banco (referenciada por accept_boost_order desde antes, e por
-- admin_reassign_booster/admin_reassign_booster na migration seguinte), mas
-- nenhuma migration versionada a criava -- mesmo padrão de função "criada
-- direto no banco" já encontrado nesta sessão (admin_create_manual_refund,
-- send_order_message). Sem isso, reconstruir o banco só a partir de
-- supabase/migrations/ (CI, staging novo, supabase db reset) quebra na
-- primeira função que referencia a coluna com "column does not exist".
--
-- IF NOT EXISTS torna isso seguro tanto pra reconstrução do zero (cria a
-- coluna) quanto pro banco de produção atual, que já tem ela (no-op).
alter table public.orders
  add column if not exists reassigned_by_admin boolean not null default false;

comment on column public.orders.reassigned_by_admin is
  'true quando a reserva em preferred_booster_id veio de admin_reassign_booster (admin escolheu um booster pra um pedido), não de compra direta de perfil/coaching -- accept_boost_order ignora o limite de slots/exclusivo pra esse caso.';

-- Mesmo conjunto de grants que preferred_booster_id/exclusive_until já têm
-- pra authenticated (INSERT/UPDATE/REFERENCES -- SELECT vem de uma migration
-- separada, 20260905150000, já aplicada antes desta ser escrita).
grant insert (reassigned_by_admin), update (reassigned_by_admin), references (reassigned_by_admin)
  on public.orders to authenticated;
