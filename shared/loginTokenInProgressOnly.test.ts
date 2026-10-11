import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Guarda estatica da regra "token de login so com orders.status = in_progress" (a prova real e o pgTAP 230).
const sql = readFileSync(join(__dirname, '..', 'supabase/migrations/20261010030000_login_token_in_progress_only.sql'), 'utf-8')

function body(fn: string): string {
  const start = sql.indexOf(`FUNCTION public.${fn}(`)
  expect(start).toBeGreaterThan(-1)
  const end = sql.indexOf('\n$$;', start)
  return sql.slice(start, end)
}

describe('token de login so para pedido em andamento', () => {
  for (const fn of ['get_order_credentials', 'get_duo_account_access_token', 'resolve_order_access_token', 'resolve_duo_account_access_token']) {
    it(`${fn} exige in_progress e devolve order_not_in_progress`, () => {
      const text = body(fn)
      expect(text).toContain("'in_progress'::public.order_status")
      expect(text).toContain("'order_not_in_progress'")
      expect(text).not.toMatch(/status not in \(/)
    })
  }

  it('mudar status/booster do pedido limpa o token ativo (pedido e conta duo)', () => {
    expect(sql).toContain('BEFORE UPDATE OF status, assigned_booster_id ON public.orders')
    expect(sql).toContain('new.access_token_id := null')
  })
})
