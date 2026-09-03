-- Nota interna do admin sobre um booster (visível só pro admin, nunca pro
-- próprio booster nem em listagem pública). Tabela separada em vez de coluna
-- em booster_profiles -- essa tabela já é lida com select('*') tanto pelo
-- admin (listAdminBoosters/getAdminBoosterDetail) quanto, potencialmente, em
-- queries futuras do próprio booster (hoje é allowlist explícito, mas uma
-- coluna a mais em booster_profiles fica um select('*') de distância de
-- vazar). RLS aqui é admin-only em toda operação, então não depende de
-- nenhum allowlist de coluna existir ou continuar existindo em outro lugar.
create table public.booster_admin_notes (
  booster_id uuid primary key references public.booster_profiles(id) on delete cascade,
  note       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

comment on table public.booster_admin_notes is
  'Nota livre do admin sobre um booster. Um registro por booster (upsert via '
  'set_booster_admin_note) -- não é histórico/log, é o texto atual.';

alter table public.booster_admin_notes enable row level security;

create policy booster_admin_notes_admin_only
  on public.booster_admin_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.booster_admin_notes from public, anon;
grant select on public.booster_admin_notes to authenticated;

create or replace function public.set_booster_admin_note(
  p_booster_id uuid,
  p_note       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  insert into public.booster_admin_notes(booster_id, note, updated_at, updated_by)
  values (p_booster_id, coalesce(p_note, ''), now(), auth.uid())
  on conflict (booster_id) do update
    set note = excluded.note, updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.set_booster_admin_note(uuid, text) from public, anon;
grant execute on function public.set_booster_admin_note(uuid, text) to authenticated;
