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


describe('Edge resolve-order-credentials', () => {
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
})
