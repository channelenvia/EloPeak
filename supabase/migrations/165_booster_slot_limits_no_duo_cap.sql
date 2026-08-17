-- Reajuste de política de slots do booster:
--   * Normal: 3 pedidos, de QUALQUER tipo (sem cota separada de duo) --
--     antes o normal só podia ter 1 dos 3 slots como duo.
--   * Top3: 4 pedidos (antes eram só 3), também sem cota de duo -- antes o
--     Top3 podia ter no máximo 2 dos 3 slots como duo.
--   * O bônus de 1 slot exclusivo por booster continua igual (migration 010,
--     booster_has_active_exclusive_slot) -- fora da conta dos 3/4 normais.
--
-- p_boost_mode segue como parâmetro só por compatibilidade de assinatura com
-- accept_boost_order (migration 010), que chama esta função com os dois
-- argumentos -- não afeta mais o resultado, já que não há mais cota
-- diferenciada por tipo de pedido.
create or replace function public.can_booster_accept_order(
  p_booster_user_id uuid,
  p_boost_mode      text
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_top3         boolean;
  v_max_total       integer;
  v_solo_count      integer;
  v_duo_count       integer;
  v_total_count     integer;
  v_exclusive_used  boolean;
begin
  select is_top3 into v_is_top3
  from public.booster_profiles
  where user_id = p_booster_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'booster_not_approved');
  end if;

  v_max_total := case when v_is_top3 then 4 else 3 end;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  v_exclusive_used := public.booster_has_active_exclusive_slot(p_booster_user_id);

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'is_top3', v_is_top3,
    'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
  );
end;
$$;
