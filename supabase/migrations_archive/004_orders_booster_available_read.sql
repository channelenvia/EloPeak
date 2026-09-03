-- ─────────────────────────────────────────────────────────────────────────────
-- orders_customer_read (001_initializing.sql) só libera SELECT para
-- customer_id/assigned_booster_id = auth.uid() ou admin. Pedidos ainda sem
-- booster atribuído (status = 'awaiting_assignment', assigned_booster_id
-- null) não satisfazem nenhuma dessas condições — a tela "Vagas Disponíveis"
-- do booster (AvailableJobs.tsx) fica sempre vazia para qualquer booster.
-- Esta policy libera leitura desses pedidos para boosters aprovados.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_approved_booster()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.booster_profiles
    where user_id = auth.uid() and status = 'approved'
  )
$$;

create policy "orders_booster_available_read" on public.orders for select using (
  status = 'awaiting_assignment'
  and assigned_booster_id is null
  and public.is_approved_booster()
);
