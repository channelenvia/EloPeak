-- ─────────────────────────────────────────────────────────────────────────────
-- Reforma do configurador de boost (Solo Boost, Duo Boost, Boost Master+).
--
-- 1) service_extras ganha `flow`/`code`: os 4 extras genéricos antigos viram
--    histórico (is_active = false, continuam legíveis pelos pedidos antigos
--    via o snapshot congelado em orders.extras — nada é deletado). Os novos
--    12 addons (4 por fluxo × 3 fluxos) usam código estável (`code`), nunca
--    o texto do label, como identificador.
-- 2) master_plus_pricing: tabela comercial nova (origem × destino × faixa de
--    PDL atual). Semeada com price = NULL — os valores ainda precisam ser
--    definidos pelo time comercial via painel admin. Pedidos Master+ para
--    uma combinação sem preço configurado devem ser rejeitados pela Edge
--    Function, nunca criados com valor inventado.
-- 3) orders ganha colunas para persistir o que hoje se perdia: PDL atual e
--    sua faixa, médias de PDL ganho/perdido, e uma versão de precificação.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) service_extras: flow + code ──────────────────────────────────────────

alter table public.service_extras
  add column if not exists flow text,
  add column if not exists code text;

alter table public.service_extras
  drop constraint if exists service_extras_flow_check;
alter table public.service_extras
  add constraint service_extras_flow_check
  check (flow is null or flow in ('solo_standard', 'duo_standard', 'master_plus'));

-- Unicidade só entre linhas novas (flow/code preenchidos) — múltiplas linhas
-- legadas com flow/code nulos continuam permitidas (NULL não colide em
-- unique index no Postgres).
drop index if exists service_extras_flow_code_idx;
create unique index service_extras_flow_code_idx
  on public.service_extras (flow, code)
  where flow is not null and code is not null;

-- Extras genéricos antigos (pré-reforma) viram histórico — deixam de
-- aparecer no configurador, mas continuam existindo para pedidos antigos
-- que os referenciam pelo snapshot em orders.extras.
update public.service_extras
set    is_active = false
where  flow is null;

-- Novos addons por fluxo. Percentuais e ordem conforme especificação de
-- produto — "priority" é sempre sort_order = 4 (último) nos 3 fluxos.
with lol_elo_boost as (
  select s.id
  from public.services s
  join public.games g on g.id = s.game_id
  where g.slug = 'lol' and s.type = 'elo_boost'
  limit 1
)
insert into public.service_extras (service_id, name, description, price_modifier, price_modifier_pct, sort_order, icon, is_active, flow, code)
select lol_elo_boost.id, t.name, t.description, 0, t.pct, t.sort_order, t.icon, true, t.flow, t.code
from lol_elo_boost, (values
  -- Solo Boost (Iron–Diamond)
  ('Apenas Solo',
   'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.',
   30, 1, 'user',           'solo_standard', 'solo_only'),
  ('Mono Champ',
   'O booster joga seu campeão favorito em todas as partidas, quando possível.',
   20, 2, 'crosshair',      'solo_standard', 'mono_champ'),
  ('Transmissão ao Vivo',
   'Assista seu booster jogar em tempo real durante todo o serviço.',
   15, 3, 'tv',             'solo_standard', 'live_stream'),
  ('Acesso Prioritário',
   'Atribuição imediata ao booster mais bem avaliado. Seu pedido vai direto para frente da fila.',
   15, 4, 'zap',            'solo_standard', 'priority'),

  -- Duo Boost (Iron–Diamond)
  ('Duo Indetectável',
   'O serviço poderá ser realizado com diferentes contas parceiras durante a progressão, sem depender exclusivamente de uma única conta durante todas as partidas.',
   30, 1, 'shield',         'duo_standard', 'undetectable_duo'),
  ('Gameplay Explicativa',
   'O booster explica decisões, estratégias, movimentações e objetivos relevantes durante as partidas.',
   30, 2, 'lightbulb',      'duo_standard', 'explanatory_gameplay'),
  ('Voice',
   'Booster e cliente em comunicação pelo voice do jogo durante as partidas.',
   15, 3, 'mic',            'duo_standard', 'duo_voice'),
  ('Acesso Prioritário',
   'Atribuição imediata ao booster mais bem avaliado. Seu pedido vai direto para frente da fila.',
   15, 4, 'zap',            'duo_standard', 'priority'),

  -- Boost Master+
  ('Gameplay Explicativa',
   'O booster explica decisões, estratégias, movimentações e objetivos relevantes durante as partidas.',
   50, 1, 'lightbulb',      'master_plus', 'explanatory_gameplay'),
  ('Mono Champ',
   'O booster joga seu campeão favorito em todas as partidas, quando possível.',
   30, 2, 'crosshair',      'master_plus', 'mono_champ'),
  ('Transmissão ao Vivo',
   'Assista seu booster jogar em tempo real durante todo o serviço.',
   15, 3, 'tv',             'master_plus', 'live_stream'),
  ('Acesso Prioritário',
   'Atribuição imediata ao booster mais bem avaliado. Seu pedido vai direto para frente da fila.',
   20, 4, 'zap',            'master_plus', 'priority')
) as t(name, description, pct, sort_order, icon, flow, code);

-- ── 2) master_plus_pricing ───────────────────────────────────────────────────

create table if not exists public.master_plus_pricing (
  id            uuid primary key default gen_random_uuid(),
  current_tier  text not null check (current_tier in ('master', 'grandmaster')),
  target_tier   text not null check (target_tier in ('grandmaster', 'challenger')),
  pdl_bracket   text not null check (pdl_bracket in ('0_49', '50_89', '90_119', '120_plus')),
  -- NULL = faixa ainda não precificada pelo time comercial. Pedidos para uma
  -- combinação com price NULL devem ser rejeitados, nunca criados com um
  -- valor inventado.
  price         numeric(10,2),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),
  constraint master_plus_pricing_progression_check check (
    (current_tier = 'master' and target_tier in ('grandmaster', 'challenger'))
    or (current_tier = 'grandmaster' and target_tier = 'challenger')
  ),
  unique (current_tier, target_tier, pdl_bracket)
);

create or replace function public.set_master_plus_pricing_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_master_plus_pricing_updated_at on public.master_plus_pricing;
create trigger set_master_plus_pricing_updated_at
  before update on public.master_plus_pricing
  for each row execute function public.set_master_plus_pricing_updated_at();

alter table public.master_plus_pricing enable row level security;

drop policy if exists "master_plus_pricing_read" on public.master_plus_pricing;
create policy "master_plus_pricing_read" on public.master_plus_pricing for select using (
  price is not null or public.is_admin()
);

drop policy if exists "master_plus_pricing_admin_write" on public.master_plus_pricing;
create policy "master_plus_pricing_admin_write" on public.master_plus_pricing for all using (
  public.is_admin()
) with check (public.is_admin());

-- 3 progressões válidas × 4 faixas de PDL = 12 combinações. Preço NULL até
-- o time comercial preencher pelo painel administrativo.
insert into public.master_plus_pricing (current_tier, target_tier, pdl_bracket, price)
values
  ('master', 'grandmaster', '0_49',     null),
  ('master', 'grandmaster', '50_89',    null),
  ('master', 'grandmaster', '90_119',   null),
  ('master', 'grandmaster', '120_plus', null),
  ('master', 'challenger',  '0_49',     null),
  ('master', 'challenger',  '50_89',    null),
  ('master', 'challenger',  '90_119',   null),
  ('master', 'challenger',  '120_plus', null),
  ('grandmaster', 'challenger', '0_49',     null),
  ('grandmaster', 'challenger', '50_89',    null),
  ('grandmaster', 'challenger', '90_119',   null),
  ('grandmaster', 'challenger', '120_plus', null)
on conflict (current_tier, target_tier, pdl_bracket) do nothing;

-- ── 3) orders: colunas de PDL do Master+ e versão de precificação ───────────

alter table public.orders
  add column if not exists current_pdl   integer,
  add column if not exists pdl_bracket   text,
  add column if not exists avg_pdl_gain  numeric(6,2),
  add column if not exists avg_pdl_loss  numeric(6,2),
  add column if not exists pricing_version text not null default 'v1';

alter table public.orders
  drop constraint if exists orders_current_pdl_check;
alter table public.orders
  add constraint orders_current_pdl_check check (current_pdl is null or current_pdl >= 0);

alter table public.orders
  drop constraint if exists orders_pdl_bracket_check;
alter table public.orders
  add constraint orders_pdl_bracket_check
  check (pdl_bracket is null or pdl_bracket in ('0_49', '50_89', '90_119', '120_plus'));

alter table public.orders
  drop constraint if exists orders_avg_pdl_gain_check;
alter table public.orders
  add constraint orders_avg_pdl_gain_check check (avg_pdl_gain is null or avg_pdl_gain > 0);

alter table public.orders
  drop constraint if exists orders_avg_pdl_loss_check;
alter table public.orders
  add constraint orders_avg_pdl_loss_check check (avg_pdl_loss is null or avg_pdl_loss > 0);
