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
