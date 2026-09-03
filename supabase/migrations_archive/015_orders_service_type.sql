-- orders.service_id stores services.id (uuid, as text) — never the
-- service_type slug. The access-token gating added for credentials
-- (orderRequiresAccountAccess in OrderDetail.tsx / JobDetail.tsx) compares
-- order.service_id directly against slugs like 'elo_boost', which can never
-- match a uuid and was always false. Denormalize service_type onto orders at
-- creation time instead — the same pattern already used for pricing_version
-- and boost_mode — so app code can gate on it without joining back to the
-- mutable services catalog.
alter table public.orders add column if not exists service_type public.service_type;

update public.orders o
set service_type = s.type
from public.services s
where s.id::text = o.service_id
  and o.service_type is null;

alter table public.orders alter column service_type set not null;

create index if not exists orders_service_type_idx on public.orders(service_type);
