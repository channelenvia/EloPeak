-- Duo Boost passa a aceitar duas origens de conta: a "conta da plataforma"
-- (pool gerenciado em duo_accounts, já existente) ou a "conta própria" do
-- booster -- ele só informa o Riot ID, sem precisar de token (é a própria
-- conta dele, já tem acesso). duo_own_riot_id fica em orders porque é
-- 1:1 com o pedido, não um recurso reutilizável entre pedidos como as
-- contas da plataforma.
--
-- set_duo_own_riot_id (abaixo) referencia duo_account_reservations, criada
-- só na migration 148 -- seguro porque plpgsql não valida a existência de
-- tabelas no CREATE FUNCTION, só na hora de EXECUTAR, e as migrations rodam
-- em ordem numérica (147 antes de 148) num único deploy antes de qualquer
-- chamada real à função.

alter table public.orders add column duo_own_riot_id text;

create or replace function public.set_duo_own_riot_id(p_order_id uuid, p_riot_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_trimmed text;
  v_previous_account_id uuid;
begin
  select id, status, boost_mode, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if v_order.boost_mode is distinct from 'duo' then
    return jsonb_build_object('success', false, 'error', 'not_duo_order');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  v_trimmed := btrim(coalesce(p_riot_id, ''));
  -- Mesmo formato "Nome#TAG" validado no configurador do cliente
  -- (StepConfigure.tsx) -- precisa de conteúdo antes E depois do '#'.
  if length(v_trimmed) < 3 or length(v_trimmed) > 60
     or position('#' in v_trimmed) < 2
     or position('#' in v_trimmed) = length(v_trimmed) then
    return jsonb_build_object('success', false, 'error', 'invalid_riot_id');
  end if;

  -- Se o booster tinha uma conta da PLATAFORMA reservada pra este pedido e
  -- muda pra "conta própria", libera a reserva antiga -- sem isso,
  -- sync-order-matches priorizava a conta da plataforma (duo_accounts) e
  -- ficava atribuindo partidas a uma conta que a UI não mostra mais como
  -- selecionada, ignorando silenciosamente a conta própria recém-salva.
  -- Captura o account_id ANTES de zerar reserved_order_id -- senão a
  -- atualização do histórico abaixo não encontraria mais a linha (mesma
  -- pegadinha que reserve_duo_account já evita com v_previous_account_id).
  select id into v_previous_account_id
  from public.duo_accounts where reserved_order_id = p_order_id;

  if v_previous_account_id is not null then
    update public.duo_accounts
      set reserved_by = null, reserved_order_id = null, reserved_at = null,
          last_released_by = auth.uid(), last_released_at = now()
      where id = v_previous_account_id;

    update public.duo_account_reservations
      set released_at = now(), released_by = auth.uid()
      where account_id = v_previous_account_id and released_at is null;
  end if;

  update public.orders
    set duo_own_riot_id = v_trimmed, updated_at = now()
    where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.set_duo_own_riot_id(uuid, text) from public, anon;
grant execute on function public.set_duo_own_riot_id(uuid, text) to authenticated;

create or replace function public.clear_duo_own_riot_id(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  select id, assigned_booster_id into v_order
  from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  update public.orders set duo_own_riot_id = null, updated_at = now() where id = p_order_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.clear_duo_own_riot_id(uuid) from public, anon;
grant execute on function public.clear_duo_own_riot_id(uuid) to authenticated;
