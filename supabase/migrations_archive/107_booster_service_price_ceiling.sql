-- booster_services.price só tinha piso (> 0, migration 076), sem teto -- nem
-- no client nem no servidor. Um booster podia cadastrar um serviço a
-- R$ 999.999,00 sem nenhuma validação barrar. Não é um exploit de terceiros
-- (é o próprio preço que o booster oferece, o cliente decide comprar ou não),
-- mas é ausência de guarda-corpo anti-abuso -- um valor absurdo pode ser
-- usado pra manipular métricas/ranking ou só poluir o catálogo público.
--
-- Teto de R$ 10.000,00: generoso o bastante pra não travar nenhum pacote de
-- coaching legítimo (o preço mais alto hoje no catálogo -- Master+ no tier
-- mais caro -- é ~R$ 2.150), mas fecha o caso degenerado.
--
-- Rodando contra o banco real, o ALTER TABLE recusou o CHECK porque já
-- existia uma linha violando o teto (booster_services.id =
-- da7869c3-c51c-4afa-b7c3-16c8b911c8f0, título "asf357735", price
-- R$ 357.735,00). Um CHECK vale pra toda linha independente de is_active, então
-- só desativar não bastava. Confirmado que é dado de teste da própria equipe
-- (banco ainda em ambiente de testes) -- apagamos a linha.

delete from public.booster_services
where id = 'da7869c3-c51c-4afa-b7c3-16c8b911c8f0' and price > 10000;

alter table public.booster_services
  drop constraint if exists booster_services_price_ceiling,
  add constraint booster_services_price_ceiling check (price <= 10000);
