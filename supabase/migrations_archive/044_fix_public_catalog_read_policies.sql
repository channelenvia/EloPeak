-- Políticas públicas não devem referenciar is_admin(): anon não possui
-- EXECUTE nessa função e o Postgres valida a permissão mesmo quando a linha
-- ativa já satisfaria o outro lado do OR. Separamos leitura pública e leitura
-- administrativa para manter o catálogo acessível sem ampliar privilégios.

drop policy if exists "games_public_read" on public.games;
drop policy if exists "games_admin_read" on public.games;
create policy "games_public_read"
  on public.games for select to anon, authenticated
  using (is_active = true);
create policy "games_admin_read"
  on public.games for select to authenticated
  using (public.is_admin());

drop policy if exists "services_public_read" on public.services;
drop policy if exists "services_admin_read" on public.services;
create policy "services_public_read"
  on public.services for select to anon, authenticated
  using (is_active = true);
create policy "services_admin_read"
  on public.services for select to authenticated
  using (public.is_admin());

drop policy if exists "service_extras_public_read" on public.service_extras;
drop policy if exists "service_extras_admin_read" on public.service_extras;
create policy "service_extras_public_read"
  on public.service_extras for select to anon, authenticated
  using (is_active = true);
create policy "service_extras_admin_read"
  on public.service_extras for select to authenticated
  using (public.is_admin());

drop policy if exists "master_plus_pricing_read" on public.master_plus_pricing;
drop policy if exists "master_plus_pricing_admin_read" on public.master_plus_pricing;
create policy "master_plus_pricing_read"
  on public.master_plus_pricing for select to anon, authenticated
  using (price is not null);
create policy "master_plus_pricing_admin_read"
  on public.master_plus_pricing for select to authenticated
  using (public.is_admin());
