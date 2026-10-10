-- M-52: CPF e nome de exibicao unicos com erro claro (sem unique_violation cru) e bio limitada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c1@t.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c2@t.local', '{}');

create function pg_temp.apply_as(p_user uuid, p_name text, p_cpf text, p_bio text default 'Sou muito bom') returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return public.onboard_booster(p_name, p_bio, '{"tier":"challenger"}'::jsonb, 'https://op.gg/x', 1, 4, 'Nome Completo', p_cpf, array['mon']);
end $$;

select is((pg_temp.apply_as('00000000-0000-0000-0000-0000000000c1', 'Alfa', '52998224725')->>'success')::boolean, true, 'primeira candidatura passa');
select is(pg_temp.apply_as('00000000-0000-0000-0000-0000000000c2', 'Beta', '529.982.247-25')->>'error', 'cpf_taken', 'mesmo CPF em outra conta e recusado com erro claro');
select is(pg_temp.apply_as('00000000-0000-0000-0000-0000000000c2', 'alfa', '11144477735')->>'error', 'display_name_taken', 'nome de exibicao repetido (sem diferenciar maiusculas) e recusado com erro claro');
select is(pg_temp.apply_as('00000000-0000-0000-0000-0000000000c2', 'Beta', '11144477735', repeat('x', 257))->>'error', 'bio_too_long', 'bio acima de 256 caracteres e recusada');
select is((pg_temp.apply_as('00000000-0000-0000-0000-0000000000c2', 'Beta', '11144477735')->>'success')::boolean, true, 'dados distintos passam');

select * from finish();
rollback;
