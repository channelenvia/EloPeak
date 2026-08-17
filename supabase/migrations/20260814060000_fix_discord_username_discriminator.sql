-- Bug: username de boosters/clientes logados via Discord estava sendo salvo
-- com "_0" no final (ex: "flashlol1_0") e esse campo não é editável pelo
-- usuário depois (só o display_name é). Confirmado direto no banco:
--   raw_user_meta_data->>'name'      = 'flashlol1#0'   <- com tag legado
--   raw_user_meta_data->>'full_name' = 'flashlol1'     <- já limpo
-- O Discord migrou toda conta pro sistema de username único e fixou o
-- discriminator em "0" pra quem não tem mais tag (praticamente todo mundo
-- hoje). raw_user_meta_data->>'username' vem null pro provider Discord, então
-- handle_new_user() caía pro ->>'name', que ainda inclui "#0", e o
-- regexp_replace de sanitização vira "#" em "_", sobrando o "_0".
--
-- Fix: preferir full_name (sem tag) sobre name, e como reforço remover
-- qualquer sufixo "#<dígitos>" residual antes de sanitizar, caso full_name
-- não venha preenchido em algum provider futuro.

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
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1),
    'user'
  );
  v_username := regexp_replace(v_username, '#\d+$', '');
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

-- Backfill: corrige quem já foi cadastrado com o "_0" indevido, só quando dá
-- pra confirmar que veio exatamente desse bug (o "name" salvo em auth.users
-- bate com o username atual + tag "#0" de volta) e o nome limpo não colide
-- com o username de outra pessoa.
update public.profiles p
set username = fixed.new_username
from (
  select
    p2.id,
    left(regexp_replace(regexp_replace(u.raw_user_meta_data->>'full_name', '#\d+$', ''), '[^a-zA-Z0-9_]', '_', 'g'), 30) as new_username
  from public.profiles p2
  join auth.users u on u.id = p2.id
  where p2.username like '%\_0'
    and u.raw_user_meta_data->>'name' = replace(p2.username, '_0', '#0')
    and u.raw_user_meta_data->>'full_name' is not null
) fixed
where p.id = fixed.id
  and fixed.new_username <> ''
  and not exists (
    select 1 from public.profiles p3
    where p3.username = fixed.new_username and p3.id <> fixed.id
  );
