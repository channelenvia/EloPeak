import { describe, it, expect } from 'vitest'
import { isWithdrawalWindowOpen, nextWithdrawalDayLabel } from './payoutWithdrawalWindow'

// Datas em UTC ao meio-dia: o dia em America/Sao_Paulo (UTC-3) coincide com o dia UTC.
describe('isWithdrawalWindowOpen', () => {
  it('is open on the 15th', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-15T12:00:00Z'))).toBe(true)
  })

  it('is open on the last day of the month, whatever its number', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-31T12:00:00Z'))).toBe(true)
    expect(isWithdrawalWindowOpen(new Date('2026-09-30T12:00:00Z'))).toBe(true)
    expect(isWithdrawalWindowOpen(new Date('2027-02-28T12:00:00Z'))).toBe(true)
    expect(isWithdrawalWindowOpen(new Date('2028-02-29T12:00:00Z'))).toBe(true)
  })

  it('is closed on any other day (including the 30th of a 31-day month)', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-16T12:00:00Z'))).toBe(false)
    expect(isWithdrawalWindowOpen(new Date('2026-08-30T12:00:00Z'))).toBe(false)
    expect(isWithdrawalWindowOpen(new Date('2027-02-14T12:00:00Z'))).toBe(false)
  })
})

describe('nextWithdrawalDayLabel', () => {
  it('points to itself when today is already a withdrawal day', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-08-15T12:00:00Z'))).toBe('15/08')
    expect(nextWithdrawalDayLabel(new Date('2026-08-31T12:00:00Z'))).toBe('31/08')
  })

  it('points to the last day of the month when between the 15th and the end', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-08-20T12:00:00Z'))).toBe('31/08')
    expect(nextWithdrawalDayLabel(new Date('2026-02-20T12:00:00Z'))).toBe('28/02')
  })

  it('rolls over to the 15th of the next month after the last day', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-09-01T12:00:00Z'))).toBe('15/09')
  })
})
