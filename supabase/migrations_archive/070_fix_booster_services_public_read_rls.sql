-- booster_services_read (migration 030) checa aprovação do booster com um
-- EXISTS direto em public.booster_profiles. Essa subquery roda sob a RLS de
-- QUEM está consultando — e booster_profiles só permite ao próprio dono ou a
-- um admin ler qualquer linha (booster_profiles_read_own_or_admin, migration
-- 001; é assim de propósito, a tabela tem PII). Resultado: para um cliente
-- (ou anon) olhando o booster_id de OUTRA pessoa, o EXISTS sempre avalia
-- false — a cláusula "leitura pública" nunca funcionou de fato, só o ramo
-- `booster_id = auth.uid()` (o próprio booster vendo seus serviços). Todo
-- pacote de coaching fica invisível para clientes, mesmo ativo e com o
-- booster aprovado. Confirmado ao vivo: existe 1 linha coaching/is_active em
-- produção, mas `set role anon; select * from booster_services;` retorna 0
-- linhas.
--
-- Além disso, a mesma migration 030 removeu sem querer o filtro
-- `is_active = true` que a leitura pública tinha desde a migration 003 —
-- reintroduzido aqui junto com o fix de RLS.
--
-- Correção segue o mesmo padrão já usado para checagem de admin
-- (public.is_admin(), migration 001): uma função SECURITY DEFINER que
-- responde só a pergunta "esse booster está aprovado?", sem expor nenhuma
-- outra coluna de booster_profiles — mesma ideia de public_booster_profiles
-- (view), mas utilizável dentro de uma policy de outra tabela.

create or replace function public.is_approved_booster(p_booster_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.booster_profiles
    where user_id = p_booster_id and status = 'approved'
  )
$$;

grant execute on function public.is_approved_booster(uuid) to anon, authenticated;

drop policy if exists "booster_services_read" on public.booster_services;
create policy "booster_services_read" on public.booster_services
for select
using (
  booster_id = auth.uid()
  or (is_active and public.is_approved_booster(booster_id))
);
