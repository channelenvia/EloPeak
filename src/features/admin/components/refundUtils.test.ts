import { describe, expect, it } from 'vitest'
import type { Refund } from '@/types'
import { matchesRefundSearch, refundStatusLabel, refundStatusTone } from './refundUtils'

const base = { order_id: 'ABCDEF12-0000', is_manual: true } as Refund

describe('refundUtils', () => {
  it('labels a manual failed refund as undone', () => {
    expect(refundStatusLabel({ ...base, status: 'failed' })).toBe('Desfeito')
  })
  it('labels a provider failed refund as failed', () => {
    expect(refundStatusLabel({ ...base, is_manual: false, status: 'failed' })).toBe('Falhou')
  })
  it('maps status to tone', () => {
    expect(refundStatusTone('succeeded')).toContain('text-success')
    expect(refundStatusTone('failed')).toContain('text-danger')
    expect(refundStatusTone('pending')).toContain('text-warning')
  })
  it('matches search case-insensitively and ignores blank', () => {
    expect(matchesRefundSearch(base, ' abcdef ')).toBe(true)
    expect(matchesRefundSearch(base, 'zzz')).toBe(false)
    expect(matchesRefundSearch(base, '  ')).toBe(true)
  })
})
