-- Serviços de coaching podem estar referenciados por pedidos históricos.
-- Arquivá-los preserva essa relação e os detalhes do pedido, mas remove o
-- pacote das telas do booster, do perfil público e de novas compras.

alter table public.booster_services
  add column if not exists deleted_at timestamptz;

create index if not exists booster_services_not_deleted_idx
  on public.booster_services (booster_id, created_at)
  where deleted_at is null;

comment on column public.booster_services.deleted_at is
  'Soft delete: null enquanto disponível no catálogo; preenchido quando o booster exclui o serviço.';
