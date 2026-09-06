-- Duas listas-alvo pra cron jobs novos (Edge Functions chamadas via
-- pg_cron, mesmo padrão de refresh-top3-boosters/discord-top3-announcement,
-- migration_archive 073/127): quem recebe o lembrete de janela de saque
-- (dias 15/30) e quem recebe o lembrete de inatividade (cliente sem pedido
-- há 15+ dias). Ambas security definer, só pro service_role -- não fazem
-- sentido chamadas por um usuário logado, e não dependem de auth.uid()
-- (a function existente booster_available_balance é gated por
-- auth.uid() = p_booster_id or is_admin(), o que não vale pro contexto de
-- cron/service role, então calcula o saldo direto aqui em vez de reusá-la).

create or replace function public.list_payout_reminder_targets()
returns table(booster_id uuid, discord_id text, available_balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select bp.user_id, p.discord_id, coalesce(sum(le.amount), 0) as available_balance
  from public.booster_profiles bp
  join public.profiles p on p.id = bp.user_id
  join public.booster_ledger_entries le on le.booster_id = bp.user_id
  where bp.status = 'approved'
    and p.discord_id is not null
  group by bp.user_id, p.discord_id
  having coalesce(sum(le.amount), 0) >= 50.00;
$$;

revoke all on function public.list_payout_reminder_targets() from public, anon, authenticated;
grant execute on function public.list_payout_reminder_targets() to service_role;

alter table public.profiles
  add column last_inactivity_dm_sent_at timestamptz;

comment on column public.profiles.last_inactivity_dm_sent_at is
  'Última vez que o cron discord-customer-inactivity-reminder mandou o DM de reengajamento -- evita repetir o lembrete todo dia enquanto o cliente continuar inativo (repete só a cada 15 dias).';

-- "Já pediu antes e sumiu": tem pelo menos 1 pedido (qualquer status -- até
-- um cancelado conta como já ter usado a plataforma) e o mais recente foi há
-- 15+ dias. Quem nunca fez pedido nenhum não entra aqui -- não é
-- "reengajamento", é alguém que nunca chegou a comprar.
create or replace function public.list_customer_inactivity_reminder_targets()
returns table(customer_id uuid, discord_id text, last_order_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.discord_id, max(o.created_at)
  from public.profiles p
  join public.orders o on o.customer_id = p.id
  where p.role = 'customer'
    and p.discord_id is not null
    and (p.last_inactivity_dm_sent_at is null or p.last_inactivity_dm_sent_at < now() - interval '15 days')
  group by p.id, p.discord_id
  having max(o.created_at) < now() - interval '15 days';
$$;

revoke all on function public.list_customer_inactivity_reminder_targets() from public, anon, authenticated;
grant execute on function public.list_customer_inactivity_reminder_targets() to service_role;

create or replace function public.mark_customer_inactivity_reminder_sent(p_customer_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_inactivity_dm_sent_at = now() where id = any(p_customer_ids);
$$;

revoke all on function public.mark_customer_inactivity_reminder_sent(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_customer_inactivity_reminder_sent(uuid[]) to service_role;
