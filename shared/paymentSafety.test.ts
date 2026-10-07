import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { classifyExistingPixPayment } from '../supabase/functions/_shared/pixPayment'

describe('proteção contra PIX órfão', () => {
  it.each(['pending', 'in_process', 'authorized'])('reutiliza pagamento ativo (%s)', (status) => {
    expect(classifyExistingPixPayment(status)).toBe('reuse')
  })

  it('reconhece pagamento já aprovado', () => {
    expect(classifyExistingPixPayment('approved')).toBe('already_paid')
  })

  it.each(['rejected', 'cancelled', 'refunded', 'charged_back', 'unknown', null])(
    'bloqueia nova cobrança quando o pagamento anterior é terminal ou desconhecido (%s)',
    (status) => {
      expect(classifyExistingPixPayment(status)).toBe('blocked')
    },
  )
})

describe('alerta de pagamento aprovado após cancelamento', () => {
  it('só dispara na transição para paid, exige pedido canceled e deduplica por pedido', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations/20261006000000_alert_payment_approved_after_cancellation.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toContain("v_order_status = 'canceled'::public.order_status")
    expect(sql).toContain("old.status is distinct from 'paid'::public.payment_status")
    expect(sql).toContain("new.status = 'paid'::public.payment_status")
    expect(sql).toContain("type = 'payment_approved_after_cancellation'")
    expect(sql).toContain("data->>'order_id' = new.order_id::text")
  })
})
