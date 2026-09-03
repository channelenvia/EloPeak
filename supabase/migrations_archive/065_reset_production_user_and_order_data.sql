-- Reset de produção: apaga TODO dado de usuário/pedido/transação, mantendo
-- só as tabelas de catálogo/configuração (games, services, service_extras,
-- master_plus_pricing). Ordem respeita as FKs reais do schema (a maioria dos
-- vínculos pra profiles/orders é NO ACTION, não CASCADE, então filhos
-- precisam ser limpos explicitamente antes dos pais).
--
-- master_plus_pricing.updated_by referencia profiles(id) — como essa tabela
-- é mantida, só a coluna é zerada, a linha (e o preço) continua intacta.
--
-- auth.users é apagado por último: profiles.id -> auth.users(id) é
-- ON DELETE CASCADE, e booster_profiles/customer_profiles/notifications ->
-- profiles também são CASCADE, então isso sozinho já limparia essas quatro
-- tabelas — mas todo o resto (orders, payments, reviews etc.) precisa estar
-- vazio antes, senão as constraints NO ACTION bloqueiam o delete.

update public.master_plus_pricing set updated_by = null;

delete from public.audit_logs;
delete from public.reviews;
delete from public.refunds;
delete from public.payout_records;
delete from public.payments;
delete from public.order_rank_verifications;
delete from public.order_status_history;
delete from public.order_messages;
delete from public.order_matches;
delete from public.order_drop_requests;
delete from public.booster_order_events;
delete from public.orders;
delete from public.duo_accounts;
delete from public.booster_services;
delete from public.booster_performance_segments;
delete from public.notifications;
delete from public.edge_rate_limits;
delete from public.booster_profiles;
delete from public.customer_profiles;
delete from public.profiles;
delete from auth.users;
