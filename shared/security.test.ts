import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from '../supabase/functions/_shared/crypto'
import { fetchWithTimeout, HttpError, readJsonBody } from '../supabase/functions/_shared/http'

describe('Edge HTTP hardening', () => {
  it('compares webhook secrets correctly for equal and unequal lengths', () => {
    expect(constantTimeEqual('same-secret', 'same-secret')).toBe(true)
    expect(constantTimeEqual('same-secret', 'same-secreu')).toBe(false)
    expect(constantTimeEqual('short', 'longer-secret')).toBe(false)
  })

  it('rejects non-JSON and oversized bodies', async () => {
    await expect(readJsonBody(new Request('http://local.test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }))).rejects.toMatchObject({ status: 415 } satisfies Partial<HttpError>)

    await expect(readJsonBody(new Request('http://local.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(128) }),
    }), 32)).rejects.toMatchObject({ status: 413 } satisfies Partial<HttpError>)
  })

  it('parses a bounded JSON object', async () => {
    await expect(readJsonBody(new Request('http://local.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"ok":true}',
    }))).resolves.toEqual({ ok: true })
  })

  it('keeps the shared timeout helper exported for Edge Function boot', () => {
    expect(fetchWithTimeout).toBeTypeOf('function')
  })
})

describe('Database authorization migration', () => {
  it('não expira pedido salvo antes de existir uma cobrança PIX', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/045_persist_unpaid_orders_before_pix.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain('o.mp_payment_id is not null')
    expect(sql).toContain("p.status = 'pending'")
    expect(sql).toContain("p.created_at < now() - interval '35 minutes'")
    expect(sql).not.toContain("o.created_at < now() - interval '35 minutes'")
  })

  it('locks trust fields and projects available orders without sensitive columns', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/007_security_integrity_and_payment_atomicity.sql', import.meta.url),
      'utf8',
    )
    expect(sql).toContain('drop policy if exists "booster_profiles_insert_own"')
    expect(sql).toContain('sender_role = public.current_user_role()')
    expect(sql).toContain('o.assigned_booster_id = booster_id')
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('process_mp_payment_event')

    const projection = sql.slice(
      sql.indexOf('create or replace view public.available_boost_orders'),
      sql.indexOf('revoke all on public.available_boost_orders'),
    )
    expect(projection).not.toContain('customer_id')
    expect(projection).not.toContain('game_credentials')
    expect(projection).not.toContain('mp_payment_id')
  })

  it('centraliza o chat do pedido em RPCs e exige booster atribuido', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/034_order_chat_controls.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain('o.assigned_booster_id is not null')
    expect(sql).toContain('drop policy if exists "order_messages_insert"')
    expect(sql).toContain('revoke insert, update, delete on table public.order_messages from authenticated')
    expect(sql).toContain('create or replace function public.send_order_message')
    expect(sql).toContain('values (p_order_id, v_user_id, v_role, v_content, false)')
    expect(sql).toContain("if v_order.chat_locked and v_role <> 'admin'::public.user_role")
    expect(sql).toContain('create or replace function public.admin_set_order_chat_lock')
    expect(sql).toContain('if not public.is_admin()')
    expect(sql).toContain('public.check_own_write_rate_limit')
  })

  it('nao permite que as telas gravem diretamente em order_messages', async () => {
    const pages = await Promise.all([
      '../src/features/customer/pages/OrderDetail.tsx',
      '../src/features/booster/pages/JobDetail.tsx',
      '../src/features/admin/pages/OrderDetail.tsx',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))

    for (const page of pages) {
      expect(page).toContain('<OrderChat')
      expect(page).not.toContain("from('order_messages')")
      expect(page).not.toContain("queryKey: ['order-messages'")
    }
  })

  it('reconcilia o schema remoto sem referencias ao modulo de tickets removido', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/035_remote_schema_reconciliation.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain('drop function if exists public.assign_ticket(uuid)')
    expect(sql).not.toContain('from public.support_tickets')
    expect(sql).toContain("'sender_avatar_url', p.avatar_url")
    expect(sql).not.toContain('bp.avatar_url')
    expect(sql).toContain('create or replace function public.admin_dashboard_stats()')
  })

  it('so libera credenciais de pedidos pagos e revoga o token em estados terminais', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/036_order_credentials_backend_hardening.sql', import.meta.url),
      'utf8',
    )

    const occurrences = sql.split("payment_status is distinct from 'paid'::public.payment_status").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)

    expect(sql).toContain('create or replace function public.clear_terminal_order_credentials()')
    expect(sql).toContain("new.status in ('completed', 'canceled', 'refunded', 'disputed')")
    expect(sql).toContain('new.game_credentials := null')
    expect(sql).toContain('before update of status, payment_status on public.orders')
  })

  it('exige o booster autenticado e atribuido para resolver o token de acesso', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/036_order_credentials_backend_hardening.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain('p_booster_user_id uuid')
    expect(sql).toContain('and assigned_booster_id = p_booster_user_id')
    expect(sql).toContain("bp.status = 'approved'")
    expect(sql).toContain('revoke all on function public.resolve_order_access_token(text, uuid) from public, anon, authenticated')
    expect(sql).toContain('grant execute on function public.resolve_order_access_token(text, uuid) to service_role')
  })

  it('esconde o payload cifrado de credenciais de select(*) via grants de coluna', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/036_order_credentials_backend_hardening.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain('revoke select on public.orders from anon, authenticated')
    const grant = sql.slice(sql.indexOf('grant select ('), sql.indexOf('on public.orders to authenticated'))
    expect(grant).not.toContain('game_credentials')
    expect(grant).toContain('credential_expires_at')
  })

  it('resolve-order-credentials usa a sessao autenticada do booster, nunca um id vindo do corpo', async () => {
    const source = await readFile(
      new URL('../supabase/functions/resolve-order-credentials/index.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('getAuthUser(req.headers.get')
    expect(source).toContain('consumeUserRateLimit(')
    expect(source).toContain('p_booster_user_id: user.id')
    expect(source).not.toContain('p_booster_user_id: parsedBody')
    expect(source).not.toContain('console.log')
    expect(source).not.toMatch(/console\.\w+\([^)]*result\.(login|password)/)
  })

  it('segura pedidos pagos que exigem credenciais e so os libera depois do envio', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/047_paid_credentials_handoff.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain("when v_requires_credentials then 'awaiting_customer'::public.order_status")
    expect(sql).toContain("else 'awaiting_assignment'::public.order_status")
    expect(sql).toContain("'requires_credentials', v_requires_credentials")
    expect(sql).toContain('create or replace function public.release_paid_order_after_credentials()')
    expect(sql).toContain("and new.status = 'awaiting_customer'::public.order_status")
    expect(sql).toContain("set status = 'awaiting_assignment'")
    expect(sql).toContain('after update of credentials_set on public.orders')
    expect(sql).toContain('and new.assigned_booster_id is null')
  })

  it('cancela PIX vencido no backend e executa a limpeza a cada minuto', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations_archive/048_expired_pix_cleanup_schedule.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain("set status = 'canceled'")
    expect(sql).toContain("p.created_at < now() - interval '35 minutes'")
    expect(sql).toContain("'PIX expirado sem confirmação de pagamento'")
    expect(sql).toContain("'* * * * *'")
    expect(sql).toContain('perform cron.unschedule')
  })
})
