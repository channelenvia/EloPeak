import { describe, expect, it } from 'vitest'
import { toAppZoneWallClock } from './timezone'
import { getClashDateParts } from './clashDomain'
import { formatDateTime } from './utils'

describe('fuso do app (America/Sao_Paulo)', () => {
  it('converte um instante UTC para o relogio de parede de Sao Paulo, qualquer que seja o fuso do navegador', () => {
    const wall = toAppZoneWallClock(new Date('2026-10-10T02:30:00Z')) // 23:30 do dia 9 em SP
    expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([2026, 10, 9, 23, 30])
  })

  it('formatDateTime mostra o horario de Sao Paulo', () => {
    expect(formatDateTime('2026-10-10T02:30:00Z')).toContain('09 out 2026 · 23:30')
  })

  it('o proximo sabado do Clash parte do dia de Sao Paulo, nao do UTC', () => {
    // sexta 09/10 23:30 em SP = sabado 10/10 02:30 UTC: o proximo sabado e o dia 10, nao 17
    expect(getClashDateParts('2026-10-10T02:30:00Z', 'saturday')).toEqual({ day: '10', month: '10' })
    // sabado 10/10 00:30 em SP (03:30 UTC) continua sendo o proprio sabado
    expect(getClashDateParts('2026-10-10T03:30:00Z', 'saturday')).toEqual({ day: '10', month: '10' })
    // domingo 11/10 01:00 em SP: o proximo domingo e hoje
    expect(getClashDateParts('2026-10-11T04:00:00Z', 'sunday')).toEqual({ day: '11', month: '10' })
  })
})
