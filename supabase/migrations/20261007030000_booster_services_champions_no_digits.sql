-- Nome de campeão nunca tem número: o formulário do booster já remove
-- dígitos ao digitar, e este check garante o mesmo contra escritas diretas
-- pela API. NOT VALID: linhas antigas que eventualmente tenham dígito não
-- travam a migration, mas qualquer INSERT/UPDATE novo é validado (ao editar
-- um pacote antigo, o booster precisa corrigir o nome).

alter table public.booster_services
  drop constraint if exists booster_services_champions_no_digits,
  add constraint booster_services_champions_no_digits check (
    champions is null
    or array_to_string(champions, ',') !~ '[[:digit:]]'
  ) not valid;
