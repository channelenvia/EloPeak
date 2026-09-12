-- Gap encontrado em auditoria: audit_logs tem uma RLS policy correta desde
-- sempre (audit_logs_admin_read, migrations_archive/001, using is_admin()),
-- mas NUNCA recebeu o grant de tabela correspondente -- sem
-- "grant select ... to authenticated", o Postgres nega o select antes até
-- de chegar na policy, então mesmo um admin nunca conseguiria ler esta
-- tabela pelo client (PostgREST). É por isso que nenhuma tela de admin
-- expõe audit_logs até hoje, apesar de todo RPC administrativo já gravar
-- nela com o motivo de cada ação.
grant select on public.audit_logs to authenticated;
