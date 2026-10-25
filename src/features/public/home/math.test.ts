import { describe, expect, it } from 'vitest'
import { clamp, easeInOutCubic, mapRange } from './math'

describe('clamp', () => {
  it('limita ao intervalo padrão 0..1', () => {
    expect(clamp(-3)).toBe(0)
    expect(clamp(7)).toBe(1)
    expect(clamp(0.4)).toBe(0.4)
  })
})

describe('mapRange', () => {
  it('mantém o primeiro valor antes do primeiro ponto', () => {
    expect(mapRange(-1, [0, 0.4, 1], [0, 100, 50])).toBe(0)
  })
  it('interpola linearmente entre trechos', () => {
    expect(mapRange(0.2, [0, 0.4, 1], [0, 100, 50])).toBeCloseTo(50)
    expect(mapRange(0.7, [0, 0.4, 1], [0, 100, 50])).toBeCloseTo(75)
  })
  it('mantém o último valor depois do último ponto', () => {
    expect(mapRange(2, [0, 0.4, 1], [0, 100, 50])).toBe(50)
  })
})

describe('easeInOutCubic', () => {
  it('fixa as pontas e o meio', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBe(0.5)
  })
})
