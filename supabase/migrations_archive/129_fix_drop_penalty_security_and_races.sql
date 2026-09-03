-- Corrige 3 achados do checkup de segurança/atomicidade feito em cima da
-- migration 128 (booster_drop_penalties):
--
--   1) CRÍTICO: blocked_until nunca foi adicionado ao trigger de proteção
--      de colunas de confiança do booster_profiles
--      (trg_fn_guard_booster_profile_trust_columns, migration 077) -- um
--      booster bloqueado conseguia se autodesbloquear direto via
--      `supabase.from('booster_profiles').update({ blocked_until: null })`,
--      porque RLS só valida dono da linha, não quais colunas. Sem o trigger
--      "devolvendo" o valor antigo, o update passava.
--
--   2) Race real: o débito da taxa de drop em apply_order_drop() nunca
--      travava a linha de booster_profiles (só o crédito de payout fazia
--      isso, via `update total_earnings`). request_payout() trava
--      booster_profiles com FOR UPDATE antes de checar o saldo -- mas como
--      o débito da taxa não competia por essa mesma trava, um saque e uma
--      taxa de drop concorrentes podiam os dois passar a validação de saldo
--      antes de qualquer um commitar, deixando o saldo ficar negativo na
--      prática.
--
--   3) Race real: as contagens de ocorrência (light_loss) e advertências
--      ativas em apply_order_drop() são um `select count(*)` sem nenhuma
--      trava -- dois drops do mesmo booster em pedidos DIFERENTES,
--      resolvidos quase ao mesmo tempo (ex: admin dropando dois pedidos em
--      sequência rápida), podiam os dois ler a mesma contagem "antiga" e
--      os dois classificarem como "1ª ocorrência", quando deveria ser
--      1ª + 2ª.
--
--   O mesmo `select ... from booster_profiles where user_id = ... for
--   update` resolve (2) e (3) ao mesmo tempo: serializa contra
--   request_payout (mesma linha) E serializa drops concorrentes do mesmo
--   booster entre si (ambos disputam a mesma trava antes de contar).

-- ── Fix 1: blocked_until protegido contra escrita direta do client ──────
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
    new.blocked_until    := old.blocked_until;
  end if;
  return new;
end;
$$;

-- ── Fix 2 + 3: apply_order_drop trava booster_profiles antes de classificar ─
create or replace function public.apply_order_drop(
  p_order_id uuid,
  p_from_status text,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  v_price_changed       boolean;
  v_games_played        integer;
  v_bucket              text;
  v_fee_pct             numeric := 0;
  v_fee_amount          numeric := 0;
  v_warning_issued      boolean := false;
  v_light_loss_count    integer;
  v_prior_warnings      integer;
  v_new_warning_count   integer;
  v_new_blocked_until   timestamptz;
begin
  select id, service_type, total_price, current_rank, customer_id,
         assigned_booster_id, estimated_hours, wins_played, losses_played
  into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.assigned_booster_id is null then
    return jsonb_build_object('completion_pct', 0, 'payout_amount', 0);
  end if;

  -- Trava a linha do booster ANTES de ler qualquer saldo/contagem --
  -- serializa contra request_payout() (mesma linha) e contra outro
  -- apply_order_drop() concorrente do mesmo booster (mesma trava, ordens
  -- diferentes). Ver comentário no topo da migration 129.
  perform 1 from public.booster_profiles where user_id = v_order.assigned_booster_id for update;

  v_completion_pct  := public.order_drop_completion_pct(p_order_id);
  v_completion_frac := v_completion_pct / 100.0;
  v_price_changed   := v_completion_frac > 0;

  select coalesce(is_top3, false) into v_is_top3
    from public.booster_profiles where user_id = v_order.assigned_booster_id;
  v_share_pct := case when v_is_top3 then 0.60 else 0.55 end;

  v_payout          := round(v_order.total_price * v_share_pct * v_completion_frac, 2);
  v_new_total_price := round(v_order.total_price * (1 - v_completion_frac), 2);
  v_new_estimated_hours := case
    when v_order.estimated_hours is not null
      then round(v_order.estimated_hours * (1 - v_completion_frac), 2)
    else null
  end;

  -- ── Classificação do drop e taxa/advertência ────────────────────────────
  v_games_played := coalesce(v_order.wins_played, 0) + coalesce(v_order.losses_played, 0);

  if v_order.losses_played > v_order.wins_played and v_order.losses_played >= 3 then
    v_bucket := 'heavy_loss';
    v_fee_pct := 0.10;
    v_warning_issued := true;

  elsif v_order.losses_played > v_order.wins_played then
    v_bucket := 'light_loss';

    select count(*) into v_light_loss_count
    from public.order_drop_requests
    where booster_id = v_order.assigned_booster_id
      and status = 'approved'
      and waived_at is null
      and penalty_bucket = 'light_loss'
      and resolved_at > now() - interval '30 days';

    if v_light_loss_count = 0 then
      v_fee_pct := 0; v_warning_issued := false;
    elsif v_light_loss_count = 1 then
      v_fee_pct := 0.05; v_warning_issued := false;
    else
      v_fee_pct := 0.05; v_warning_issued := true;
    end if;

  else
    v_bucket := 'tied_or_winning';
    if v_games_played <= 6 then
      v_fee_pct := 0; v_warning_issued := false;
    else
      v_fee_pct := 0; v_warning_issued := true;
    end if;
  end if;

  v_fee_amount := round(v_order.total_price * v_fee_pct, 2);

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
    match_sync_started_at  = null,
    last_match_synced_at   = null,
    current_rank           = v_new_current_rank,
    rank_before_last_drop  = v_order.current_rank,
    drop_count             = drop_count + 1,
    last_dropped_at        = now(),
    updated_at             = now()
  where id = p_order_id;

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
      'Taxa de drop (' || round(v_fee_pct * 100) || '%) referente ao pedido ' || p_order_id::text,
      p_actor_id, 'admin'::public.user_role
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_fee_applied', 'Taxa de drop aplicada',
      'Uma taxa de ' || round(v_fee_pct * 100) || '% (R$ ' || v_fee_amount::text
        || ') foi descontada do seu saldo por dropar um pedido em desvantagem.',
      jsonb_build_object('order_id', p_order_id, 'amount', v_fee_amount, 'pct', v_fee_pct)
    );
  end if;

  if v_warning_issued then
    select count(*) into v_prior_warnings
    from public.order_drop_requests
    where booster_id = v_order.assigned_booster_id
      and status = 'approved'
      and waived_at is null
      and warning_issued = true
      and resolved_at > now() - interval '30 days';

    v_new_warning_count := v_prior_warnings + 1;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_order.assigned_booster_id, 'drop_warning_issued', 'Advertência de drop',
      'Você recebeu uma advertência (' || v_new_warning_count || '/5 ativas). '
        || 'Elas expiram 30 dias após serem geradas.',
      jsonb_build_object('order_id', p_order_id, 'active_warnings', v_new_warning_count)
    );

    if v_new_warning_count = 2 then
      v_new_blocked_until := now() + interval '6 hours';
    elsif v_new_warning_count = 3 then
      v_new_blocked_until := now() + interval '16 hours';
    end if;

    if v_new_blocked_until is not null then
      update public.booster_profiles
      set blocked_until = greatest(coalesce(blocked_until, v_new_blocked_until), v_new_blocked_until)
      where user_id = v_order.assigned_booster_id;

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.assigned_booster_id, 'booster_temporarily_blocked', 'Bloqueio temporário',
        'Você está impedido de pegar novos pedidos até '
          || to_char(v_new_blocked_until at time zone 'America/Sao_Paulo', 'HH24:MI DD/MM') || '.',
        jsonb_build_object('blocked_until', v_new_blocked_until)
      );
    end if;

    if v_new_warning_count = 5 then
      update public.booster_profiles set status = 'suspended'
      where user_id = v_order.assigned_booster_id;

      insert into public.notifications(user_id, type, title, body, data)
      values (
        v_order.assigned_booster_id, 'booster_auto_suspended', 'Conta suspensa',
        'Sua conta foi suspensa automaticamente após atingir 5 advertências ativas.',
        jsonb_build_object('active_warnings', v_new_warning_count)
      );
    end if;
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
    'completion_pct', v_completion_pct,
    'payout_amount', v_payout,
    'penalty_bucket', v_bucket,
    'penalty_fee_pct', v_fee_pct,
    'penalty_fee_amount', v_fee_amount,
    'warning_issued', v_warning_issued
  );
end;
$$;

-- Documentação/defesa em profundidade: reafirma explicitamente que só o
-- owner (via SECURITY DEFINER) pode chamar esta função -- já era verdade
-- transitivamente (revoke original na migration 116 sobrevive a todo
-- CREATE OR REPLACE), mas deixa explícito nesta migration também.
revoke all on function public.apply_order_drop(uuid, text, uuid, text) from public, anon, authenticated;

-- ── Fix defensivo: penalty_fee_pct só pode ser um dos 3 valores que a
-- regra de negócio realmente produz (0, 5% ou 10%) ─────────────────────
alter table public.order_drop_requests
  add constraint order_drop_requests_penalty_fee_pct_check
  check (penalty_fee_pct is null or penalty_fee_pct in (0, 0.05, 0.10));
