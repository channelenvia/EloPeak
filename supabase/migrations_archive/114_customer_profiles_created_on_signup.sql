-- Causa raiz do bug "aba Clientes do admin só mostra quem comprou
-- recentemente": customer_profiles nunca era criado para ninguém. Ao
-- contrário de booster_profiles (criado via onboard_booster() quando o
-- booster se candidata), não existia NENHUM caminho -- trigger, RPC, edge
-- function ou frontend -- que inserisse uma linha em customer_profiles pro
-- cliente. trg_fn_order_paid_customer_stats só faz UPDATE (silenciosamente
-- não faz nada se a linha não existe), então a lista de clientes do admin
-- (que lê direto de customer_profiles) ficava vazia pra qualquer cliente
-- real, dando a impressão de um filtro por data que nunca existiu.
--
-- Fix: handle_new_user() passa a criar a linha em customer_profiles junto
-- com profiles, no mesmo insert do cadastro -- espelha o padrão já usado
-- pra profiles, sem exigir uma etapa de "aplicação" como o booster tem.
-- on conflict do nothing porque profiles já usa on conflict do update pra
-- cobrir re-signup OAuth; aqui não há coluna alguma pra atualizar de volta.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role       public.user_role;
  v_email      text;
  v_username   text;
  v_discord_id text;
begin
  v_role := case
    when new.raw_user_meta_data->>'role' = 'booster' then 'booster'::public.user_role
    else 'customer'::public.user_role
  end;

  v_email := coalesce(
    new.email,
    new.raw_user_meta_data->>'email',
    new.id::text || '@oauth.local'
  );

  v_username := coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1),
    'user'
  );
  v_username := left(regexp_replace(v_username, '[^a-zA-Z0-9_]', '_', 'g'), 30);
  if v_username = '' then v_username := 'user'; end if;

  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 22) || '_' || left(new.id::text, 7);
  end if;

  v_discord_id := coalesce(
    new.raw_user_meta_data->>'provider_id',
    new.raw_user_meta_data->>'sub'
  );

  insert into public.profiles(id, email, role, username, discord_id)
  values (new.id, v_email, v_role, v_username, v_discord_id)
  on conflict (id) do update
    set discord_id = coalesce(excluded.discord_id, profiles.discord_id);

  if v_role = 'customer' then
    insert into public.customer_profiles(user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Backfill: qualquer profile role='customer' já existente que nunca ganhou
-- a linha (todo mundo, hoje) -- roda uma vez, idempotente por causa do
-- unique(user_id) + on conflict.
insert into public.customer_profiles(user_id)
select p.id
from public.profiles p
where p.role = 'customer'
on conflict (user_id) do nothing;
