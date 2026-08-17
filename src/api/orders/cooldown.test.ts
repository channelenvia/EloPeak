// A lógica de cooldown em si (calcular segundos restantes a partir de um
// timestamp-alvo) é extraída pra uma função pura testável em isolamento --
// testar o hook inteiro exigiria montar QueryClientProvider + fake timers
// só pra validar uma conta de subtração, sem ganho real de cobertura.
import { describe, expect, it } from 'vitest'
import { secondsRemaining } from './cooldown'

describe('secondsRemaining', () => {
  it('retorna 0 quando não há cooldown ativo', () => {
    expect(secondsRemaining(null, 1_000)).toBe(0)
  })

  it('arredonda pra cima os segundos restantes', () => {
    expect(secondsRemaining(1_000 + 29_500, 1_000)).toBe(30)
  })

  it('retorna 0 quando o cooldown já expirou', () => {
    expect(secondsRemaining(500, 1_000)).toBe(0)
  })
})
