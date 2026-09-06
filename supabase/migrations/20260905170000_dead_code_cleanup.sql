-- Sprint 1 de limpeza de código morto (auditoria completa da aplicação).
-- Cada item abaixo foi confirmado ao vivo antes de remover: zero chamador
-- interno (prosrc de qualquer função), zero trigger, zero cron job, zero
-- referência no repo (grep em src/, supabase/functions/, shared/, scripts/ --
-- só aparecem em src/lib/database.types.ts, que é gerado e se limpa sozinho
-- no próximo `supabase gen types`).

-- ─── Funções sem nenhum chamador (nem RPC-alcançável -- só service_role) ────
drop function if exists public.cancel_order_after_drop_limit(uuid, text, uuid, text, public.drop_requester_role);
drop function if exists public.booster_payout_summary(uuid);
drop function if exists public.set_duo_account_credentials(uuid, text, text);
drop function if exists public.update_my_username(text);

-- ─── Feature inteira morta: central de suporte/escalação de pedido ──────────
-- request_order_support/admin_resolve_order_support são RPC-alcançáveis
-- (authenticated tinha EXECUTE), mas a funcionalidade nunca chegou a ser
-- construída no frontend -- zero referência em src/ além do types.ts gerado,
-- e a tabela está vazia (confirmado: 0 linhas).
drop function if exists public.request_order_support(uuid);
drop function if exists public.admin_resolve_order_support(uuid);
drop table if exists public.order_support_escalations cascade;

-- ─── Colunas nunca lidas nem escritas por nenhuma função, view ou tela ──────
alter table public.booster_profiles drop column if exists queue_preferences;
alter table public.booster_profiles drop column if exists region_preferences;
alter table public.orders drop column if exists booster_notes;

-- ─── pg_trgm é a única extensão do projeto instalada em `public` em vez de
-- `extensions` (pg_net/pgcrypto/uuid-ossp/pg_stat_statements já seguem esse
-- padrão) -- isso expõe suas ~30 funções (similarity, gtrgm_*, etc.) a
-- authenticated/anon via RPC por padrão de schema público, sem que nenhum
-- índice ou busca fuzzy no app de fato use trigram (confirmado: nenhum
-- índice gin/trgm existe em nenhuma tabela). Move pro schema certo em vez de
-- só revogar grant por grant -- já é convenção do projeto (toda função usa
-- search_path 'public','extensions'), e cobre qualquer função nova que a
-- extensão venha a expor no futuro.
alter extension pg_trgm set schema extensions;
