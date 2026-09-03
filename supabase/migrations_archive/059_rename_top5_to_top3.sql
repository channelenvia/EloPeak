-- Renomeia o conceito legado "Top 5" (contagem de pedidos completados no
-- mês, usado só pro bônus de slot duo extra do booster) para "Top 3", já
-- que o produto não usa mais "top 5" em lugar nenhum e o frontend já tinha
-- sido migrado pra ler `is_top3` (deixando as queries que selecionavam essa
-- coluna literalmente quebradas em produção, 400 "column does not exist").
-- Continua sendo uma feature operacional separada da vitrine pública
-- (get_top_boosters, migration 055) — só o critério de corte muda de 5 para
-- 3 boosters/mês pra ficar consistente com o resto do produto.

alter table public.booster_profiles rename column is_top5 to is_top3;

drop view if exists public.public_booster_profiles;
create view public.public_booster_profiles as
select
  bp.id, bp.user_id, bp.display_name, bp.bio, bp.current_rank, bp.peak_rank,
  bp.games, bp.rating, bp.rating_count, bp.total_completed, bp.is_top3,
  bp.rank_stats, bp.last_active_at, bp.updated_at, bp.lanes, bp.specialties,
  p.avatar_url
from public.booster_profiles bp
join public.profiles p on p.id = bp.user_id
where bp.status = 'approved'::public.booster_status;

grant select, insert, update, delete, truncate, references, trigger
  on public.public_booster_profiles to anon, authenticated;

create or replace function public.trg_fn_guard_booster_profile_trust_columns()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.status          := old.status;
    new.total_completed := old.total_completed;
    new.total_earnings  := old.total_earnings;
    new.rating          := old.rating;
    new.rating_count    := old.rating_count;
    new.is_top3         := old.is_top3;
    new.verified_at     := old.verified_at;
    new.current_rank    := old.current_rank;
    new.rank_stats      := old.rank_stats;
  end if;
  return new;
end;
$$;

alter function public.refresh_top5_boosters() rename to refresh_top3_boosters;

create or replace function public.refresh_top3_boosters()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_top3_ids uuid[];
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  select array_agg(sub.user_id) into v_top3_ids
  from (
    select bp.user_id
    from   public.booster_profiles bp
    join   public.orders o on o.assigned_booster_id = bp.user_id
    where  o.status = 'completed'
      and  date_trunc('month', o.completed_at) = date_trunc('month', now())
    group  by bp.user_id
    order  by count(*) desc
    limit  3
  ) sub;

  update public.booster_profiles set is_top3 = false where is_top3 = true;

  if v_top3_ids is not null and array_length(v_top3_ids, 1) > 0 then
    update public.booster_profiles set is_top3 = true where user_id = any(v_top3_ids);
  end if;
end;
$$;

alter function public.trg_order_completed_refresh_top5() rename to trg_order_completed_refresh_top3;

create or replace function public.trg_order_completed_refresh_top3()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    perform public.refresh_top3_boosters();
  end if;
  return new;
end;
$$;

alter trigger order_completed_refresh_top5 on public.orders rename to order_completed_refresh_top3;

create or replace function public.can_booster_accept_order(p_booster_user_id uuid, p_boost_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_is_top3         boolean;
  v_max_total       integer;
  v_max_duo         integer;
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

  if v_is_top3 then
    v_max_total := 3; v_max_duo := 2;
  else
    v_max_total := 3; v_max_duo := 1;
  end if;

  select solo_count, duo_count, total_count
  into   v_solo_count, v_duo_count, v_total_count
  from   public.booster_active_slot_counts(p_booster_user_id);

  v_exclusive_used := public.booster_has_active_exclusive_slot(p_booster_user_id);

  if v_total_count >= v_max_total then
    return jsonb_build_object(
      'allowed', false, 'reason', 'slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  if p_boost_mode = 'duo' and v_duo_count >= v_max_duo then
    return jsonb_build_object(
      'allowed', false, 'reason', 'duo_slot_limit_reached',
      'solo_count', v_solo_count, 'duo_count', v_duo_count,
      'total_count', v_total_count, 'max_total', v_max_total,
      'max_duo', v_max_duo, 'is_top3', v_is_top3,
      'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'solo_count', v_solo_count, 'duo_count', v_duo_count,
    'total_count', v_total_count, 'max_total', v_max_total,
    'max_duo', v_max_duo, 'is_top3', v_is_top3,
    'exclusive_slot_used', v_exclusive_used, 'max_exclusive', 1
  );
end;
$$;

-- CREATE OR REPLACE não permite renomear parâmetros (p_is_top5 -> p_is_top3),
-- então trocamos a função inteira (drop + create) em vez de alter+replace.
drop function if exists public.toggle_booster_top5(uuid, boolean);

create function public.toggle_booster_top3(p_booster_id uuid, p_is_top3 boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_actor record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set is_top3 = p_is_top3, updated_at = now()
  where id = p_booster_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role,
          case when p_is_top3 then 'booster.top3_granted' else 'booster.top3_removed' end,
          'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.toggle_booster_top3(uuid, boolean) to authenticated;
