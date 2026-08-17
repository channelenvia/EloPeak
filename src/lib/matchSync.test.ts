import { describe, expect, it } from 'vitest'
import { AUTO_SYNC_INTERVAL_MS, shouldAutoSync } from './matchSync'

const NOW = new Date('2026-08-03T12:00:00Z').getTime()

describe('shouldAutoSync', () => {
  it('false para status não sincronizável', () => {
    expect(shouldAutoSync({ status: 'assigned', last_match_synced_at: null }, NOW)).toBe(false)
    expect(shouldAutoSync({ status: 'completed', last_match_synced_at: null }, NOW)).toBe(false)
  })

  it('true para in_progress/paused/drop_requested nunca sincronizados', () => {
    for (const status of ['in_progress', 'paused', 'drop_requested'] as const) {
      expect(shouldAutoSync({ status, last_match_synced_at: null }, NOW)).toBe(true)
    }
  })

  it('false quando o último sync foi há menos de 30 min', () => {
    const lastSync = new Date(NOW - 10 * 60 * 1000).toISOString()
    expect(shouldAutoSync({ status: 'in_progress', last_match_synced_at: lastSync }, NOW)).toBe(false)
  })

  it('true quando o último sync foi há 30 min ou mais', () => {
    const lastSync = new Date(NOW - AUTO_SYNC_INTERVAL_MS).toISOString()
    expect(shouldAutoSync({ status: 'in_progress', last_match_synced_at: lastSync }, NOW)).toBe(true)
  })
})
