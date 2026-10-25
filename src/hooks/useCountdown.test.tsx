// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCountdown } from './useCountdown'

afterEach(() => vi.useRealTimers())

describe('useCountdown com relogio do servidor', () => {
  it('relogio do navegador adiantado nao encurta o prazo: o offset do servidor corrige', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:10:00Z')) // navegador 10 min adiantado
    const expiresAt = '2026-10-08T12:30:00Z' // servidor ainda em 12:00 => 30 min restantes
    const serverOffsetMs = new Date('2026-10-08T12:00:00Z').getTime() - Date.now() // -10 min
    const { result } = renderHook(() => useCountdown(expiresAt, serverOffsetMs))
    expect(result.current.remaining).toBe(30 * 60)
    expect(result.current.label).toBe('30:00')
  })

  it('sem offset mantem o comportamento anterior', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const { result } = renderHook(() => useCountdown('2026-10-08T12:05:00Z'))
    expect(result.current.remaining).toBe(300)
  })
})
