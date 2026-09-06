-- Bug (MEDIUM): approve_booster converte p_new_status direto do input do
-- cliente pro enum booster_status sem allow-list -- uma chamada de admin com
-- 'removed' seta esse status direto, pulando a checagem de segurança "sem
-- pedidos ativos" que expel_booster faz antes de remover um booster.
--
-- Fix: restringir p_new_status a pending/under_review/approved/rejected/
-- suspended; remoção passa a ser exclusiva de expel_booster.
create or replace function public.approve_booster(p_booster_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor record;
  v_booster_user_id uuid;
  v_status public.booster_status;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_new_status not in ('pending', 'under_review', 'approved', 'rejected', 'suspended') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  v_status := p_new_status::public.booster_status;

  select id, role into v_actor from public.profiles where id = auth.uid();

  update public.booster_profiles
  set    status          = v_status,
         verified_at     = case when v_status = 'approved' then now() else null end,
         suspended_until = case when v_status = 'suspended' then now() + interval '24 hours' else null end,
         updated_at      = now()
  where  id = p_booster_id
  returning user_id into v_booster_user_id;

  if not found then return jsonb_build_object('success', false, 'error', 'booster_not_found'); end if;

  update public.profiles
  set role = case when v_status = 'approved' then 'booster'::public.user_role else 'customer'::public.user_role end,
      updated_at = now()
  where id = v_booster_user_id
    and role <> 'admin';

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (v_actor.id, v_actor.role, 'booster.' || v_status::text, 'booster_profile', p_booster_id::text);

  return jsonb_build_object('success', true);
end;
$function$;
