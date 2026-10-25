import { describe, expect, it } from 'vitest'
import { parseCompletionPct } from './coachCompletion'

describe('parseCompletionPct', () => {
  it('aceita 0 digitado explicitamente e valores validos', () => {
    expect(parseCompletionPct('0')).toBe(0)
    expect(parseCompletionPct('37.5')).toBe(37.5)
    expect(parseCompletionPct('100')).toBe(100)
  })
  it('campo vazio ou invalido nao vira 0', () => {
    expect(parseCompletionPct('')).toBeNull()
    expect(parseCompletionPct('  ')).toBeNull()
    expect(parseCompletionPct('abc')).toBeNull()
    expect(parseCompletionPct('101')).toBeNull()
    expect(parseCompletionPct('-1')).toBeNull()
  })
})
