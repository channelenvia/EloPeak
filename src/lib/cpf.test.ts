import { describe, expect, it } from 'vitest'
import { isValidCpf } from './cpf'

// Mesma regra de public.is_valid_cpf (banco): 11 digitos ASCII, nao repetidos, dois digitos verificadores.
describe('isValidCpf', () => {
  it('aceita CPFs validos, com ou sem mascara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224725')).toBe(true)
    expect(isValidCpf('111.444.777-35')).toBe(true)
  })

  it('rejeita digito verificador errado', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false)
    expect(isValidCpf('12345678900')).toBe(false)
  })

  it('rejeita sequencias repetidas como 000.000.000-00', () => {
    expect(isValidCpf('000.000.000-00')).toBe(false)
    expect(isValidCpf('11111111111')).toBe(false)
  })

  it('rejeita tamanho errado, vazio e digitos nao ASCII', () => {
    expect(isValidCpf('')).toBe(false)
    expect(isValidCpf('5299822472')).toBe(false)
    expect(isValidCpf('529982247255')).toBe(false)
    expect(isValidCpf('５２９９８２２４７２５')).toBe(false)
  })
})
