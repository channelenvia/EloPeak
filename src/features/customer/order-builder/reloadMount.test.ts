import { describe, it, expect, vi, beforeEach } from 'vitest'

function mockNavigationType(type: string | null) {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue((type ? [{ type }] : []) as unknown as PerformanceEntryList)
}

describe('consumeIsReloadMount (M-32)', () => {
  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks() })

  it('primeira montagem apos F5 e reload; montagens internas seguintes nao', async () => {
    mockNavigationType('reload')
    const { consumeIsReloadMount } = await import('./resumeDecision')
    expect(consumeIsReloadMount()).toBe(true)
    expect(consumeIsReloadMount()).toBe(false)
  })

  it('navegacao normal nunca e reload', async () => {
    mockNavigationType('navigate')
    const { consumeIsReloadMount } = await import('./resumeDecision')
    expect(consumeIsReloadMount()).toBe(false)
  })

  it('sem Navigation Timing nao quebra', async () => {
    mockNavigationType(null)
    const { consumeIsReloadMount } = await import('./resumeDecision')
    expect(consumeIsReloadMount()).toBe(false)
  })
})
