-- Deixa a mensagem do cooldown de troca de nome de exibição (migration 025)
-- mais direta pro usuário final -- "só pode ser alterado a cada 30 dias"
-- soava como uma regra de recorrência; o pedido foi deixar claro que é
-- "você só pode alterar novamente em 30 dias" (i.e. a partir da última troca).

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
      raise exception 'Você só pode alterar o nome de exibição novamente em 30 dias. Faltam % dia(s).', v_days_remaining
        using errcode = 'P0001';
    else
      new.display_name_changed_at := now();
    end if;
  end if;
  return new;
end;
$$;
