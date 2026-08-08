import { describe, it, expect } from 'vitest'
import { isWithdrawalWindowOpen, nextWithdrawalDayLabel } from './payoutWithdrawalWindow'

// Datas em UTC escolhidas de forma que o dia em America/Sao_Paulo (UTC-3)
// coincida com o dia UTC, evitando que o teste dependa do fuso da máquina
// que o executa.
describe('isWithdrawalWindowOpen', () => {
  it('is open on the 15th', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-15T12:00:00Z'))).toBe(true)
  })

  it('is open on the 30th', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-30T12:00:00Z'))).toBe(true)
  })

  it('is closed on any other day', () => {
    expect(isWithdrawalWindowOpen(new Date('2026-08-16T12:00:00Z'))).toBe(false)
    expect(isWithdrawalWindowOpen(new Date('2026-08-31T12:00:00Z'))).toBe(false)
  })
})

describe('nextWithdrawalDayLabel', () => {
  it('points to itself when today is already a withdrawal day', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-08-15T12:00:00Z'))).toBe('15/08')
  })

  it('points to the 30th when between the 15th and the 30th', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-08-20T12:00:00Z'))).toBe('30/08')
  })

  it('rolls over to the 15th of the next month after the 30th', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-08-31T12:00:00Z'))).toBe('15/09')
  })

  it('skips February\'s missing 30th and rolls to March 15th', () => {
    expect(nextWithdrawalDayLabel(new Date('2026-02-20T12:00:00Z'))).toBe('15/03')
  })
})
