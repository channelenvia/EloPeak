-- Nome de exibição do booster (booster_profiles.display_name) só pode ser
-- trocado a cada 30 dias, pra evitar confusão de clientes que já
-- interagiram com o pedido/booster sob o nome anterior.
--
-- Diferente do guard de trust-columns já existente para esta tabela
-- (trg_fn_guard_booster_profile_trust_columns, migration 001), que só
-- intervém quando current_user = 'authenticated' -- ou seja, deliberadamente
-- deixa passar RPCs SECURITY DEFINER como onboard_booster, porque aquelas
-- colunas só devem mudar através da lógica controlada da própria RPC --
-- este trigger precisa valer para QUALQUER caminho de escrita, incluindo
-- onboard_booster (usado tanto na candidatura inicial quanto por boosters
-- aprovados reeditando dados da candidatura, e display_name é um dos
-- campos que essa RPC também grava). Sem isso, um booster no cooldown
-- poderia simplesmente reenviar o formulário de candidatura pra trocar o
-- nome por uma porta lateral. Único bypass: administradores.

alter table public.booster_profiles
  add column if not exists display_name_changed_at timestamptz;

create or replace function public.trg_fn_enforce_booster_display_name_cooldown()
returns trigger language plpgsql set search_path = public as $$
declare
  v_days_remaining integer;
begin
  if new.display_name is distinct from old.display_name then
    if public.is_admin() then
      new.display_name_changed_at := now();
    elsif old.display_name_changed_at is not null
      and old.display_name_changed_at > now() - interval '30 days' then
      v_days_remaining := ceil(extract(epoch from ((old.display_name_changed_at + interval '30 days') - now())) / 86400);
      raise exception 'Nome de exibição só pode ser alterado a cada 30 dias. Tente novamente em % dia(s).', v_days_remaining
        using errcode = 'P0001';
    else
      new.display_name_changed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_booster_display_name_cooldown on public.booster_profiles;
create trigger trg_enforce_booster_display_name_cooldown
  before update of display_name on public.booster_profiles
  for each row execute function public.trg_fn_enforce_booster_display_name_cooldown();

comment on column public.booster_profiles.display_name_changed_at is
  'Quando display_name foi alterado pela última vez -- controla o cooldown '
  'de 30 dias (trg_fn_enforce_booster_display_name_cooldown, migration 025). '
  'Null = nunca alterado desde que esta coluna existe; próxima troca é '
  'sempre permitida nesse caso.';
