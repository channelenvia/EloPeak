-- Novo esquema de drop negativado (substitui a taxa fixa 50%/75% por papel
-- introduzida em 20260829040000_drop_penalty_by_win_value.sql):
--
-- Quando um pedido é dropado com partidas negativadas (mais derrotas que
-- vitórias desde o início/último drop), independente de quem pediu o drop
-- (cliente, booster ou admin):
--   1. O pedido re-listado (volta pro pool de jobs) é reprecificado do zero:
--      - Wins/MD5: novas vitórias contratadas = vitórias originais + partidas
--        negativadas (o próximo booster refaz tudo, não só o restante).
--      - Elo Boost: usa o rank atual RECÉM-VERIFICADO (PDLs provavelmente
--        mudaram) e recalcula a distância até o rank alvo do zero, pela
--        mesma tabela de preço por degrau usada na criação do pedido.
--   2. A diferença entre esse novo valor total e o que o cliente de fato
--      pagou (payments.amount, imutável) é descontada da wallet do booster
--      que estava no pedido -- é o dinheiro que falta pra bancar a comissão
--      de quem for terminar o trabalho extra, já que o cliente não paga de
--      novo.
--   3. O pagamento parcial por conclusão (baseado em order_drop_completion_pct)
--      continua exatamente como antes, positivo ou negativo -- não muda.
--
-- Pedido dropado POSITIVO/NEUTRO (sem partida negativada) continua 100%
-- igual ao comportamento anterior: desconto proporcional à conclusão,
-- vitórias restantes = compradas - jogadas, sem taxa nenhuma.
--
-- Fora do escopo: coaching e clash (nunca tiveram essa penalidade, sem
-- mudança). cancel_order_after_drop_limit (2º drop -- pedido é CANCELADO,
-- não re-listado) mantém a fórmula simples original (comissão% × valor da
-- vitória × partidas negativadas), só trocando o percentual fixo 50%/75%
-- pelo percentual real de comissão do booster -- não há "novo total" pra
-- calcular ali, já que o pedido não volta pro pool.
--
-- Simplificação deliberada (confirmada com o usuário): a reprecificação do
-- Elo Boost usa só a tabela de preço por degrau/tier -- não replica os
-- modificadores finos de eficiência de LP (applyLpModifier) nem o desconto
-- por PDL já avançado no Mestre+ (applyMasterPlusPdlDiscount), que existem
-- só pra afinar a estimativa da compra original.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Tabela de preço por degrau do Elo Boost (porta ELO_DIV_PRICE_CENTS /
--    ELO_DIV_PRICE_CENTS_DUO de shared/pricing.ts -- não existia no
--    Postgres ainda; win_penalty_price_cents é só o valor de UMA vitória
--    avulsa, não serve pra calcular distância de rank). Mesmo padrão de
--    win_penalty_price_cents: RLS ligada, sem nenhuma policy -- só
--    SECURITY DEFINER function acessa.
-- ═══════════════════════════════════════════════════════════════════════
create table public.elo_div_price_cents (
  queue_type text not null check (queue_type in ('solo_duo', 'flex')),
  boost_mode text not null check (boost_mode in ('solo', 'duo')),
  tier text not null,
  price_cents integer not null,
  primary key (queue_type, boost_mode, tier)
);
alter table public.elo_div_price_cents enable row level security;

insert into public.elo_div_price_cents (queue_type, boost_mode, tier, price_cents) values
  -- Solo -- ELO_DIV_PRICE_CENTS (idêntica nas duas filas)
  ('solo_duo', 'solo', 'iron', 1090), ('solo_duo', 'solo', 'bronze', 1290), ('solo_duo', 'solo', 'silver', 1690),
  ('solo_duo', 'solo', 'gold', 2190), ('solo_duo', 'solo', 'platinum', 3190), ('solo_duo', 'solo', 'emerald', 6290),
  ('solo_duo', 'solo', 'diamond', 10290),
  ('flex', 'solo', 'iron', 1090), ('flex', 'solo', 'bronze', 1290), ('flex', 'solo', 'silver', 1690),
  ('flex', 'solo', 'gold', 2190), ('flex', 'solo', 'platinum', 3190), ('flex', 'solo', 'emerald', 6290),
  ('flex', 'solo', 'diamond', 10290),
  -- Duo -- ELO_DIV_PRICE_CENTS_DUO (idêntica nas duas filas)
  ('solo_duo', 'duo', 'iron', 2090), ('solo_duo', 'duo', 'bronze', 2390), ('solo_duo', 'duo', 'silver', 2690),
  ('solo_duo', 'duo', 'gold', 3290), ('solo_duo', 'duo', 'platinum', 4890), ('solo_duo', 'duo', 'emerald', 9890),
  ('solo_duo', 'duo', 'diamond', 15790),
  ('flex', 'duo', 'iron', 2090), ('flex', 'duo', 'bronze', 2390), ('flex', 'duo', 'silver', 2690),
  ('flex', 'duo', 'gold', 3290), ('flex', 'duo', 'platinum', 4890), ('flex', 'duo', 'emerald', 9890),
  ('flex', 'duo', 'diamond', 15790);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. calc_elo_price_cents -- porta fiel de calcEloPrice() (shared/pricing.ts).
--    Usa public.rank_step (já existe, já confirmado idêntico ao rankStep()
--    do TS) pra achar o degrau de origem/destino, soma o preço por degrau
--    (tabela do tier de onde se sai, não o de destino -- mesma regra do
--    TS) até o mínimo entre o destino e o degrau de entrada no Mestre (28).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.calc_elo_price_cents(
  p_queue_type text, p_boost_mode text,
  p_from_tier text, p_from_division text,
  p_to_tier text, p_to_division text
) returns integer
language sql stable
set search_path to 'public'
as $$
  select coalesce(sum(t.price_cents), 0)::integer
  from generate_series(
    public.rank_step(p_from_tier, p_from_division) + 1,
    least(public.rank_step(p_to_tier, p_to_division), 28)
  ) as s(step)
  join public.elo_div_price_cents t
    on t.queue_type = p_queue_type
   and t.boost_mode = p_boost_mode
   and t.tier = (array['iron','bronze','silver','gold','platinum','emerald','diamond'])[least(((s.step - 1) / 4) + 1, 7)]
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Gate de "verificação de rank fresca" -- exigido antes de resolver um
--    drop negativado de Elo Boost, já que os PDLs podem ter mudado desde a
--    última sincronização. Mesmo padrão do gate de match sync já existente
--    (last_match_synced_at). Reaproveita order_rank_verifications, já
--    populada pela edge function verify-order-rank.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.elo_rank_verification_fresh(p_order_id uuid) returns boolean
language sql stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.order_rank_verifications
    where order_id = p_order_id and created_at > now() - interval '15 minutes'
  )
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. apply_order_drop -- núcleo da reprecificação. Assinatura idêntica
--    (mesmo overload, sem risco de função órfã).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.apply_order_drop(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requested_by_role drop_requester_role DEFAULT 'admin'::drop_requester_role)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order               record;
  v_completion_pct      numeric;
  v_completion_frac     numeric;
  v_is_top3             boolean;
  v_share_pct           numeric;
  v_payout              numeric;
  v_latest              record;
  v_new_current_rank    jsonb;
  v_new_total_price     numeric;
  v_new_estimated_hours numeric;
  v_new_wins_purchased  integer;
  v_price_changed       boolean;
  v_fee_amount          numeric := 0;
  v_negative_matches    integer;
  v_win_cents           integer;
  v_customer_paid       numeric;
  v_sub_master_cents    integer;
  v_master_plus_price   numeric := 0;
  v_mp_current_tier     text;
  v_tgt_tier            text;
  v_tgt_div             text;
begin
  select id, service_type, total_price, current_rank, target_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played, wins_purchased, boost_mode, queue_type
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_found_or_unassigned', 'completion_pct', 0, 'payout_amount', 0);
  end if;

  v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));

  -- Elo Boost negativado precisa de rank verificado nos últimos 15min --
  -- sem isso o novo preço usaria PDLs desatualizados. Retorna ANTES de
  -- travar/alterar qualquer coisa (nem o FOR UPDATE em booster_profiles
  -- roda ainda), pra ser seguro de tentar de novo depois de sincronizar.
  if v_order.service_type = 'elo_boost' and v_negative_matches > 0
     and not public.elo_rank_verification_fresh(p_order_id) then
    return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop', 'completion_pct', 0, 'payout_amount', 0);
  end if;

  perform 1 from public.booster_profiles where user_id = v_order.assigned_booster_id for update;

  v_completion_pct  := public.order_drop_completion_pct(p_order_id);
  v_completion_frac := v_completion_pct / 100.0;
  v_price_changed   := v_completion_frac > 0;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  -- Pagamento parcial por conclusão -- inalterado, sempre calculado
  -- independente de o drop ser negativado ou não.
  v_payout := round(v_order.total_price * v_share_pct * v_completion_frac, 2);

  v_win_cents := case
    when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
      then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
    else 0
  end;

  v_new_current_rank := v_order.current_rank;
  if v_order.service_type = 'elo_boost' and v_order.current_rank is not null then
    select fetched_tier, fetched_division into v_latest
    from public.order_rank_verifications
    where order_id = p_order_id
    order by created_at desc
    limit 1;
    if v_latest.fetched_tier is not null then
      v_new_current_rank := jsonb_build_object('tier', v_latest.fetched_tier, 'division', v_latest.fetched_division);
    end if;
  end if;

  if v_negative_matches > 0 and v_order.service_type in ('elo_boost', 'win_boost', 'md5') then
    -- Pedido dropado negativado: reprecifica do zero -- o próximo booster
    -- precisa vencer as vitórias/degraus originais MAIS o déficit deixado
    -- pelo anterior, não é mais um desconto proporcional à conclusão.
    if v_order.service_type in ('win_boost', 'md5') then
      v_new_wins_purchased := coalesce(v_order.wins_purchased, 0) + v_negative_matches;
      v_new_total_price := round((v_new_wins_purchased * v_win_cents) / 100.0, 2);
      v_new_estimated_hours := case
        when v_order.wins_purchased is not null and v_order.wins_purchased > 0 and v_order.estimated_hours is not null
          then round(v_order.estimated_hours * v_new_wins_purchased / v_order.wins_purchased, 2)
        else v_order.estimated_hours
      end;
    else -- elo_boost
      v_new_wins_purchased := v_order.wins_purchased; -- elo_boost não usa este campo
      v_tgt_tier := v_order.target_rank->>'tier';
      v_tgt_div  := v_order.target_rank->>'division';

      v_sub_master_cents := public.calc_elo_price_cents(
        v_order.queue_type::text, v_order.boost_mode,
        v_new_current_rank->>'tier', v_new_current_rank->>'division',
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then 'master' else v_tgt_tier end,
        case when v_tgt_tier in ('master', 'grandmaster', 'challenger') then null else v_tgt_div end
      );

      v_master_plus_price := 0;
      if v_tgt_tier in ('grandmaster', 'challenger') and v_order.boost_mode = 'solo' then
        v_mp_current_tier := case
          when v_new_current_rank->>'tier' in ('master', 'grandmaster', 'challenger') then v_new_current_rank->>'tier'
          else 'master'
        end;
        select price into v_master_plus_price
        from public.master_plus_pricing
        where current_tier = v_mp_current_tier and target_tier = v_tgt_tier and queue_type = v_order.queue_type
        order by pdl_from desc
        limit 1;
        v_master_plus_price := coalesce(v_master_plus_price, 0);
      end if;

      v_new_total_price := round(v_sub_master_cents / 100.0, 2) + v_master_plus_price;
      -- estimated_hours não é recalculado com precisão pro Elo Boost aqui
      -- (dependeria da mesma estimativa por PDL médio/cutoffs de liga da
      -- criação original) -- mantém o valor anterior, é só um campo de
      -- exibição de prazo, não afeta preço/comissão.
      v_new_estimated_hours := v_order.estimated_hours;
    end if;

    select amount into v_customer_paid
    from public.payments
    where order_id = p_order_id and status = 'paid'::public.payment_status
    order by created_at desc
    limit 1;

    v_fee_amount   := greatest(0, v_new_total_price - coalesce(v_customer_paid, 0));
    v_price_changed := true;
  else
    -- Drop positivo/neutro -- comportamento inalterado.
    v_new_wins_purchased := case
      when v_order.service_type in ('win_boost', 'md5') and v_order.wins_purchased is not null
        then greatest(0, v_order.wins_purchased - coalesce(v_order.wins_played, 0))
      else v_order.wins_purchased
    end;
    v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
    v_new_estimated_hours := case
      when v_order.estimated_hours is not null
        then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
      else null
    end;
  end if;

  update public.orders set
    status                 = 'awaiting_assignment',
    assigned_booster_id    = null,
    preferred_booster_id   = null,
    exclusive_until        = null,
    used_exclusive_slot    = false,
    total_price            = v_new_total_price,
    base_price             = case when v_price_changed then v_new_total_price else base_price end,
    extras_price           = case when v_price_changed then 0 else extras_price end,
    discount_price         = case when v_price_changed then 0 else discount_price end,
    estimated_hours        = v_new_estimated_hours,
    wins_purchased         = v_new_wins_purchased,
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    wins_played            = 0,
    losses_played          = 0,
    current_rank           = v_new_current_rank,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

  update public.order_booster_assignments
  set unassigned_at = now()
  where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'awaiting_assignment', p_actor_id, p_reason);

  if v_payout > 0 then
    update public.booster_profiles
    set total_earnings = total_earnings + v_payout
    where user_id = v_order.assigned_booster_id;

    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'commission_credit', v_payout,
      'Pagamento parcial (' || round(v_completion_pct) || '% concluído) pelo pedido '
        || p_order_id::text || ' antes do drop',
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_payout_credited', 'Pagamento parcial de drop',
      'Você concluiu ' || round(v_completion_pct) || '% do pedido antes do drop -- R$ '
        || v_payout::text || ' foi creditado ao seu saldo.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_payout, 'completion_pct', v_completion_pct)
    );
  end if;

  if v_fee_amount > 0 then
    insert into public.booster_ledger_entries(
      booster_id, order_id, entry_type, amount, description, actor_id, actor_role
    ) values (
      v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
      'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s) a mais de derrota que vitória). '
        || 'O pedido foi reprecificado em R$ ' || v_new_total_price::text
        || '; R$ ' || v_fee_amount::text || ' (diferença entre o novo valor e o que o cliente pagou) '
        || 'foi descontado do seu saldo, referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Este pedido estava negativado (' || v_negative_matches || ' derrota(s) a mais que vitórias) no drop. '
        || 'O pedido foi reprecificado e uma taxa de R$ ' || v_fee_amount::text
        || ' foi descontada do seu saldo para cobrir a diferença.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_fee_amount, 'negative_matches', v_negative_matches, 'new_total_price', v_new_total_price)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_reassigned', 'Pedido de volta à fila',
      'Seu pedido foi reatribuído e já está disponível para outro booster assumir.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'completion_pct', v_completion_pct,
    'payout_amount', v_payout,
    'penalty_amount', v_fee_amount,
    'negative_matches', v_negative_matches,
    'new_total_price', v_new_total_price
  );
end;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. cancel_order_after_drop_limit -- 2º drop, pedido é CANCELADO (não
--    re-listado). Só troca o percentual fixo 50%/75% pelo percentual real
--    de comissão do booster -- sem "novo total" pra calcular aqui, o
--    pedido não volta pro pool.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.cancel_order_after_drop_limit(p_order_id uuid, p_from_status text, p_actor_id uuid, p_reason text, p_requested_by_role drop_requester_role DEFAULT 'admin'::drop_requester_role)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order          record;
  v_completion_pct numeric;
  v_negative_matches integer;
  v_win_cents        integer;
  v_is_top3          boolean;
  v_share_pct        numeric := 0;
  v_fee_amount       numeric := 0;
begin
  select id, customer_id, assigned_booster_id, boost_mode, current_rank, service_type, queue_type, wins_played, losses_played
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('completion_pct', 0);
  end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);

  update public.orders set
    status     = 'canceled',
    updated_at = now()
  where id = p_order_id;

  if v_order.assigned_booster_id is not null then
    update public.order_booster_assignments
    set unassigned_at = now()
    where order_id = p_order_id and booster_id = v_order.assigned_booster_id and unassigned_at is null;
  end if;

  update public.duo_accounts
  set reserved_by = null, reserved_order_id = null, reserved_at = null
  where reserved_order_id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, p_from_status::public.order_status, 'canceled', p_actor_id, p_reason);

  if v_order.assigned_booster_id is not null then
    select coalesce(is_top3, false) into v_is_top3
      from public.booster_profiles where user_id = v_order.assigned_booster_id;
    v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

    v_negative_matches := greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0));
    v_win_cents := case
      when v_order.service_type in ('elo_boost', 'win_boost', 'md5')
        then public.win_value_cents(v_order.queue_type::text, v_order.boost_mode, v_order.current_rank->>'tier')
      else 0
    end;
    v_fee_amount := round((v_win_cents / 100.0) * v_share_pct * v_negative_matches, 2);

    if v_fee_amount > 0 then
      insert into public.booster_ledger_entries(
        booster_id, order_id, entry_type, amount, description, actor_id, actor_role
      ) values (
        v_order.assigned_booster_id, p_order_id, 'drop_penalty', -v_fee_amount,
        'Taxa de drop -- pedido negativado (' || v_negative_matches || ' partida(s), '
          || round(v_share_pct * 100) || '% (sua comissão) do valor da vitória no tier atual) referente ao pedido '
          || p_order_id::text || ' (cancelado por limite de drops)',
        p_actor_id, 'admin'::public.user_role
      );
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'order_dropped_by_admin', 'Pedido cancelado pelo admin',
      'Este pedido atingiu o limite de 2 drops e foi cancelado por um administrador. Motivo: ' || p_reason
        || case when v_fee_amount > 0
             then '. Uma taxa de R$ ' || v_fee_amount::text || ' foi descontada do seu saldo (pedido negativado).'
             else '. Nosso time vai falar com você individualmente sobre o pagamento.'
           end,
      jsonb_build_object('order_id', p_order_id, 'penalty_amount', v_fee_amount)
    );
  end if;

  if v_order.customer_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.customer_id, 'order_status_changed', 'Pedido cancelado',
      'Seu pedido atingiu o limite de 2 drops e foi cancelado. Nosso time vai entrar em contato para resolver individualmente.',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return jsonb_build_object('completion_pct', v_completion_pct, 'penalty_amount', v_fee_amount);
end;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Gates de verificação de rank fresca nos 4 pontos de entrada do fluxo
--    de drop -- só bloqueia Elo Boost já negativado no momento do check.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.request_order_drop(p_order_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_existing       uuid;
  v_completion_pct numeric;
  v_is_top3        boolean;
  v_share_pct      numeric;
  v_preview_payout numeric;
begin
  if not public.check_own_write_rate_limit('request_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, assigned_booster_id, wins_played, losses_played, total_price, last_match_synced_at, drop_count
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.assigned_booster_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.status <> 'in_progress' then
    return jsonb_build_object('success', false, 'error', 'order_not_in_progress');
  end if;
  if v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if v_order.service_type = 'elo_boost'
     and greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0)) > 0
     and not public.elo_rank_verification_fresh(p_order_id) then
    return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop');
  end if;
  if v_order.drop_count >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3 from public.booster_profiles where user_id = auth.uid();
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, auth.uid(), v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'booster', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, 'in_progress', 'drop_requested', auth.uid(), v_reason);

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$function$;

create or replace function public.request_customer_order_drop(p_order_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order          record;
  v_reason         text := trim(p_reason);
  v_existing       uuid;
  v_completion_pct numeric;
  v_is_top3        boolean;
  v_share_pct      numeric;
  v_preview_payout numeric;
begin
  if not public.check_own_write_rate_limit('request_customer_order_drop', 5, 300) then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, customer_id, assigned_booster_id, wins_played, losses_played, total_price, drop_count, last_match_synced_at
  into   v_order from public.orders where id = p_order_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'order_not_found'); end if;
  if auth.uid() is distinct from v_order.customer_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if v_order.service_type = 'elo_boost'
     and greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0)) > 0
     and not public.elo_rank_verification_fresh(p_order_id) then
    return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop');
  end if;
  if v_order.drop_count >= 2 then
    return jsonb_build_object('success', false, 'error', 'drop_limit_reached');
  end if;

  select id into v_existing from public.order_drop_requests
  where  order_id = p_order_id and status = 'pending';

  if found then return jsonb_build_object('success', false, 'error', 'drop_request_already_pending'); end if;

  v_completion_pct := public.order_drop_completion_pct(p_order_id);
  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;
  v_preview_payout := round(v_order.total_price * v_share_pct * (v_completion_pct / 100.0), 2);

  insert into public.order_drop_requests(order_id, booster_id, reason,
    wins_at_request, losses_at_request, penalty_pct, penalty_amount,
    requested_by_role, status_at_request)
  values (p_order_id, v_order.assigned_booster_id, v_reason,
    v_order.wins_played, v_order.losses_played, v_completion_pct, v_preview_payout,
    'customer', v_order.status);

  update public.orders set status = 'drop_requested', updated_at = now() where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'drop_requested', auth.uid(), v_reason);

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'customer_requested_drop', 'Cliente solicitou sair do pedido',
    'O cliente pediu para encerrar sua participação neste pedido. A solicitação está em análise pelo admin.',
    jsonb_build_object('order_id', p_order_id)
  );

  return jsonb_build_object('success', true, 'penalty_pct', v_completion_pct, 'penalty_amount', v_preview_payout);
end;
$function$;

create or replace function public.admin_drop_order(p_order_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order  record;
  v_reason text := trim(p_reason);
  v_result jsonb;
  v_request_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_reason');
  end if;

  select id, status, service_type, assigned_booster_id, wins_played, losses_played, drop_count, last_match_synced_at
  into v_order from public.orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order.assigned_booster_id is null then
    return jsonb_build_object('success', false, 'error', 'order_not_assigned');
  end if;
  if v_order.status not in ('assigned', 'in_progress', 'paused', 'awaiting_customer') then
    return jsonb_build_object('success', false, 'error', 'order_not_active');
  end if;
  if v_order.status = 'in_progress' and v_order.last_match_synced_at is null then
    return jsonb_build_object('success', false, 'error', 'sync_required_before_drop');
  end if;
  if v_order.service_type = 'elo_boost'
     and greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0)) > 0
     and not public.elo_rank_verification_fresh(p_order_id) then
    return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop');
  end if;

  if v_order.drop_count >= 2 then
    v_result := public.cancel_order_after_drop_limit(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin');

    insert into public.order_drop_requests(
      order_id, booster_id, reason, wins_at_request, losses_at_request,
      penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
      requested_by_role
    ) values (
      p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
      (v_result->>'completion_pct')::numeric, coalesce((v_result->>'penalty_amount')::numeric, 0),
      'approved', auth.uid(), 'Limite de 2 drops atingido -- pedido cancelado pelo admin', now(),
      'admin'
    )
    returning id into v_request_id;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (auth.uid(), 'admin', 'order.admin_canceled_after_drop_limit', 'order', p_order_id::text,
            jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

    return jsonb_build_object('success', true, 'canceled', true);
  end if;

  v_result := public.apply_order_drop(p_order_id, v_order.status::text, auth.uid(), v_reason, 'admin');

  if not coalesce((v_result->>'success')::boolean, true) then
    return v_result;
  end if;

  insert into public.order_drop_requests(
    order_id, booster_id, reason, wins_at_request, losses_at_request,
    penalty_pct, penalty_amount, status, admin_id, admin_note, resolved_at,
    requested_by_role
  ) values (
    p_order_id, v_order.assigned_booster_id, v_reason, v_order.wins_played, v_order.losses_played,
    (v_result->>'completion_pct')::numeric, (v_result->>'payout_amount')::numeric,
    'approved', auth.uid(), 'Drop iniciado pelo admin', now(),
    'admin'
  )
  returning id into v_request_id;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    v_order.assigned_booster_id, 'order_dropped_by_admin', 'Você foi removido de um pedido',
    'Um administrador retirou você do pedido. Motivo: ' || v_reason,
    jsonb_build_object('order_id', p_order_id)
  );

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'admin', 'order.admin_dropped', 'order', p_order_id::text,
          jsonb_build_object('reason', v_reason, 'drop_request_id', v_request_id, 'result', v_result));

  return jsonb_build_object('success', true, 'canceled', false);
end;
$function$;

create or replace function public.resolve_drop_request(p_request_id uuid, p_approve boolean, p_admin_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_req    record;
  v_actor  record;
  v_result jsonb;
  v_restore_status public.order_status;
  v_drop_count integer;
  v_order  record;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select r.id, r.order_id, r.booster_id, r.status, r.status_at_request, r.requested_by_role
  into   v_req from public.order_drop_requests r where r.id = p_request_id for update;

  if not found then return jsonb_build_object('success', false, 'error', 'request_not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;

  select id, role into v_actor from public.profiles where id = auth.uid();

  if p_approve then
    select service_type, wins_played, losses_played, drop_count into v_order
    from public.orders where id = v_req.order_id;

    if v_order.service_type = 'elo_boost'
       and greatest(0, coalesce(v_order.losses_played, 0) - coalesce(v_order.wins_played, 0)) > 0
       and not public.elo_rank_verification_fresh(v_req.order_id) then
      return jsonb_build_object('success', false, 'error', 'rank_sync_required_before_drop');
    end if;

    if coalesce(v_order.drop_count, 0) >= 2 then
      v_result := public.cancel_order_after_drop_limit(
        v_req.order_id, 'drop_requested', auth.uid(),
        coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado pelo admin'),
        v_req.requested_by_role
      );

      insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
      values (v_actor.id, v_actor.role, 'drop_request.approved_as_cancel', 'order_drop_request', p_request_id::text,
              jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

      update public.order_drop_requests
      set    status         = 'approved',
             admin_id       = auth.uid(),
             admin_note     = coalesce(p_admin_note, 'Limite de 2 drops atingido -- pedido cancelado'),
             penalty_pct    = (v_result->>'completion_pct')::numeric,
             penalty_amount = coalesce((v_result->>'penalty_amount')::numeric, 0),
             resolved_at    = now()
      where  id = p_request_id;

      return jsonb_build_object('success', true, 'canceled', true);
    end if;

    v_result := public.apply_order_drop(v_req.order_id, 'drop_requested', auth.uid(), 'Drop request approved', v_req.requested_by_role);

    if not coalesce((v_result->>'success')::boolean, true) then
      return v_result;
    end if;

    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.approved', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id, 'result', v_result));

    update public.order_drop_requests
    set    status      = 'approved',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           penalty_pct    = (v_result->>'completion_pct')::numeric,
           penalty_amount = (v_result->>'payout_amount')::numeric,
           resolved_at = now()
    where  id = p_request_id;
  else
    v_restore_status := coalesce(v_req.status_at_request, 'in_progress');

    update public.orders set status = v_restore_status, updated_at = now() where id = v_req.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (v_req.order_id, 'drop_requested', v_restore_status, auth.uid(), 'Drop request rejected');
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, diff)
    values (v_actor.id, v_actor.role, 'drop_request.rejected', 'order_drop_request', p_request_id::text,
            jsonb_build_object('order_id', v_req.order_id));

    update public.order_drop_requests
    set    status      = 'rejected',
           admin_id    = auth.uid(),
           admin_note  = p_admin_note,
           resolved_at = now()
    where  id = p_request_id;
  end if;

  return jsonb_build_object('success', true, 'canceled', false);
end;
$function$;
