import { describe, expect, it } from 'vitest'
import { maskCpf } from './utils'

describe('maskCpf', () => {
  it('esconde os digitos do meio e mantem so os extremos', () => {
    expect(maskCpf('52998224725')).toBe('529.***.***-25')
    expect(maskCpf('529.982.247-25')).toBe('529.***.***-25')
  })
  it('devolve travessao quando nao ha CPF valido', () => {
    expect(maskCpf(null)).toBe('—')
    expect(maskCpf('123')).toBe('—')
  })
})
