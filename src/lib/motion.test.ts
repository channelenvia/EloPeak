import { describe, expect, it } from 'vitest'
import { staggerStyle } from './motion'

describe('staggerStyle', () => {
  it('atrasa 40ms por item', () => {
    expect(staggerStyle(0).animationDelay).toBe('0ms')
    expect(staggerStyle(3).animationDelay).toBe('120ms')
  })
  it('trava em 7 passos (280ms) para listas longas', () => {
    expect(staggerStyle(50).animationDelay).toBe('280ms')
  })
})
