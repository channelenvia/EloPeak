-- Fecha o que a 20261007030000 deixou aberto: remove de pacotes antigos os
-- campeões com dígito (lixo de teste, ex.: "3213123123") e valida a
-- constraint, pra ela valer também para as linhas já existentes. Se sobrar
-- algum campeão válido ele é mantido; se não sobrar nenhum, vira null (o
-- check exige 1..3 itens ou null).

update public.booster_services
set champions = nullif(
  array(select c from unnest(champions) as c where c !~ '[[:digit:]]'),
  '{}'::text[]
)
where champions is not null
  and array_to_string(champions, ',') ~ '[[:digit:]]';

alter table public.booster_services
  validate constraint booster_services_champions_no_digits;
