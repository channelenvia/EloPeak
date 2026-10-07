-- Pagamento por cartão com paridade ao PIX.
--
-- payments.payment_method_type (já existia, nunca era preenchida) passa a
-- identificar o método: 'pix' | 'credit_card' | 'debit_card'. Linhas antigas e
-- novas de PIX ficam 'pix' (backfill + trigger de default).
--
-- 1) record_card_payment: mesma regra atômica do record_pix_payment (um pedido,
--    um mp_payment_id, valor conferido) + grava o método. É um wrapper de
--    propósito: mudar a assinatura do record_pix_payment criaria um overload
--    órfão em vez de substituí-lo.
-- 2) expire_stale_pix_orders: o prazo de 35 min vale só para PIX. Cartão em
--    análise (in_process vira payments.status = 'pending') pode levar horas; o
--    MP o resolve sozinho e o webhook aprova ou cancela o pedido.
-- 3) Alerta de pagamento aprovado após cancelamento deixa de dizer só "PIX".
-- 4) process_mp_payment_event: textos de histórico/notificação passam a dizer
--    "cartão" quando for o caso (patch sobre a definição VIVA, ver bloco final).

update public.payments set payment_method_type = 'pix' where payment_method_type is null;

create or replace function public.default_payment_method_type()
returns trigger
language plpgsql
as $$
begin
  new.payment_method_type := coalesce(new.payment_method_type, 'pix');
  return new;
end;
$$;

drop trigger if exists trg_payments_default_method_type on public.payments;
create trigger trg_payments_default_method_type
before insert on public.payments
for each row execute function public.default_payment_method_type();

create or replace function public.record_card_payment(
  p_order_id uuid,
  p_customer_id uuid,
  p_mp_payment_id text,
  p_amount numeric,
  p_method_type text default 'credit_card'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_method_type not in ('credit_card', 'debit_card') then
    raise exception 'invalid card method type';
  end if;

  v_result := public.record_pix_payment(p_order_id, p_customer_id, p_mp_payment_id, p_amount);

  update public.payments
  set payment_method_type = p_method_type
  where order_id = p_order_id and mp_payment_id = p_mp_payment_id;

  return v_result;
end;
$$;

revoke all on function public.record_card_payment(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_card_payment(uuid, uuid, text, numeric, text) to service_role;

create or replace function public.expire_stale_pix_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with expired as (
    update public.orders o
    set status = 'canceled', updated_at = now()
    where o.status = 'awaiting_payment'
      and o.mp_payment_id is not null
      and exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and p.mp_payment_id = o.mp_payment_id
          and p.status = 'pending'
          and coalesce(p.payment_method_type, 'pix') = 'pix'
          and p.created_at < now() - interval '35 minutes'
      )
    returning o.id, o.customer_id
  )
  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
  select
    id, 'awaiting_payment', 'canceled', customer_id,
    'PIX expirado sem confirmação de pagamento'
  from expired;
end;
$$;

revoke all on function public.expire_stale_pix_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_pix_orders() to service_role;

create or replace function public.notify_admins_on_canceled_order_payment_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status public.order_status;
begin
  select status into v_order_status
  from public.orders
  where id = new.order_id;

  if v_order_status = 'canceled'::public.order_status
     and not exists (
       select 1
       from public.notifications
       where type = 'payment_approved_after_cancellation'
         and data->>'order_id' = new.order_id::text
     ) then
    insert into public.notifications(user_id, type, title, body, data)
    select
      id,
      'payment_approved_after_cancellation',
      'Pagamento aprovado após cancelamento',
      'O Mercado Pago aprovou o pagamento (' || case when coalesce(new.payment_method_type, 'pix') = 'pix' then 'PIX' else 'cartão' end
        || ') do pedido ' || new.order_id::text
        || ' depois de o pedido já estar cancelado. O pedido não foi reaberto; reconcilie o recebimento e o eventual reembolso manualmente.',
      jsonb_build_object(
        'order_id', new.order_id,
        'payment_id', new.id,
        'mp_payment_id', new.mp_payment_id,
        'amount', new.amount
      )
    from public.profiles
    where role = 'admin';
  end if;

  return new;
end;
$$;

revoke all on function public.notify_admins_on_canceled_order_payment_approval()
  from public, anon, authenticated;

-- process_mp_payment_event grava "PIX" fixo em histórico e notificações. Em vez
-- de reescrever a função inteira a partir de uma cópia possivelmente defasada
-- do repositório, lê a definição que está no banco, troca só esses textos por
-- um CASE sobre o método do pagamento e recria. Falha alto (sem alterar nada)
-- se a definição viva não tiver o formato esperado.
do $$
declare
  v_def text := pg_get_functiondef(
    'public.process_mp_payment_event(uuid,text,text,numeric,text,text,text)'::regprocedure
  );
  v_is_card constant text := 'coalesce(v_payment.payment_method_type, ''pix'') <> ''pix''';
  v_pair record;
  v_pix_literal text;
  v_confirmed_patched boolean := false;
begin
  if position('v_payment.payment_method_type' in v_def) > 0 then
    raise notice 'process_mp_payment_event já está ciente do método; nada a fazer';
    return;
  end if;
  if position('v_payment public.payments%rowtype' in v_def) = 0 then
    raise exception 'process_mp_payment_event: variável v_payment não encontrada na definição viva; ajuste manualmente';
  end if;

  -- is_required = false: o texto "confirmado via Mercado Pago" existe em duas
  -- versões (com e sem o sufixo da janela de revisão); basta uma delas.
  for v_pair in
    select * from (values
      ('Pagamento PIX confirmado; aguardando credenciais do cliente', 'Pagamento por cartão confirmado; aguardando credenciais do cliente', true),
      ('Pagamento PIX confirmado via Mercado Pago; em revisão administrativa antes de ir pro pool', 'Pagamento por cartão confirmado via Mercado Pago; em revisão administrativa antes de ir pro pool', false),
      ('Pagamento PIX confirmado via Mercado Pago', 'Pagamento por cartão confirmado via Mercado Pago', false),
      ('PIX confirmado!', 'Pagamento confirmado!', true),
      ('Pagamento PIX recusado pelo Mercado Pago', 'Pagamento por cartão recusado pelo Mercado Pago', true),
      ('Pagamento PIX cancelado pelo Mercado Pago', 'Pagamento por cartão cancelado pelo Mercado Pago', true)
    ) as t(pix_text, card_text, is_required)
  loop
    v_pix_literal := '''' || v_pair.pix_text || '''';
    if position(v_pix_literal in v_def) = 0 then
      if v_pair.is_required then
        raise exception 'process_mp_payment_event: texto % não encontrado na definição viva; ajuste manualmente', v_pix_literal;
      end if;
      continue;
    end if;
    if v_pair.pix_text like 'Pagamento PIX confirmado via Mercado Pago%' then
      v_confirmed_patched := true;
    end if;
    v_def := replace(
      v_def,
      v_pix_literal,
      '(case when ' || v_is_card || ' then ''' || v_pair.card_text || ''' else ' || v_pix_literal || ' end)'
    );
  end loop;

  if not v_confirmed_patched then
    raise exception 'process_mp_payment_event: texto "confirmado via Mercado Pago" não encontrado na definição viva; ajuste manualmente';
  end if;

  execute v_def;
end
$$;
