-- L-13: set_booster_admin_note passa a registrar em audit_logs (quem, qual booster) e limita o tamanho da nota.
create or replace function public.set_booster_admin_note(p_booster_id uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    return jsonb_build_object('success', false, 'error', 'note_too_long');
  end if;

  insert into public.booster_admin_notes(booster_id, note, updated_at, updated_by)
  values (p_booster_id, coalesce(p_note, ''), now(), auth.uid())
  on conflict (booster_id) do update
    set note = excluded.note, updated_at = now(), updated_by = auth.uid();

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin'::public.user_role, 'booster.admin_note_set', 'booster_profile', p_booster_id::text,
          jsonb_build_object('length', length(coalesce(p_note, ''))));

  return jsonb_build_object('success', true);
end;
$function$;
