import { describe, expect, it } from 'vitest'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import { EMPTY_FORM, accountToForm, formatDurationSeconds, matchesDuoSearch, matchesDuoStatus } from './duoAccountUtils'

const acc = (o: Partial<AdminDuoAccount>) => ({ id: '1', label: 'Lbl', riot_id: 'Foo#BR1', is_active: true, reserved_by: null, current_rank: null, notes: null, ...o }) as AdminDuoAccount

describe('duoAccountUtils', () => {
  it('formats durations', () => {
    expect(formatDurationSeconds(30)).toBe('<1min')
    expect(formatDurationSeconds(125)).toBe('2min')
    expect(formatDurationSeconds(3700)).toBe('1h 1min')
    expect(formatDurationSeconds(90000)).toBe('1d 1h')
  })
  it('filters by status', () => {
    expect(matchesDuoStatus(acc({}), 'all')).toBe(true)
    expect(matchesDuoStatus(acc({ is_active: false }), 'active')).toBe(false)
    expect(matchesDuoStatus(acc({ is_active: false }), 'inactive')).toBe(true)
    expect(matchesDuoStatus(acc({ reserved_by: 'u' }), 'reserved')).toBe(true)
  })
  it('searches riot id, falling back to label', () => {
    expect(matchesDuoSearch(acc({}), ' foo')).toBe(true)
    expect(matchesDuoSearch(acc({ riot_id: null }), 'lbl')).toBe(true)
    expect(matchesDuoSearch(acc({}), 'nope')).toBe(false)
  })
  it('builds form defaults from account', () => {
    expect(accountToForm(acc({}))).toEqual({ ...EMPTY_FORM, riot_id: 'Foo#BR1' })
  })
})
