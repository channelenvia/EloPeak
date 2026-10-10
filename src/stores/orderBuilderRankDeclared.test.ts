import { beforeEach, describe, expect, it } from 'vitest'
import { useOrderBuilderStore } from './orderBuilderStore'

describe('elo declarado pelo cliente (rankDeclared)', () => {
  beforeEach(() => { useOrderBuilderStore.getState().clearRiotLookup(); useOrderBuilderStore.getState().setRiotId('') })

  it('comeca falso', () => {
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(false)
  })

  it('setRankDeclared liga e clearRiotLookup desliga (nova consulta recomeca do zero)', () => {
    const s = useOrderBuilderStore.getState()
    s.setRankDeclared(true)
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(true)
    s.clearRiotLookup()
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(false)
  })

  it('editar o Riot ID invalida o elo declarado', () => {
    const s = useOrderBuilderStore.getState()
    s.setRankDeclared(true)
    s.setRiotId('Outro#BR1')
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(false)
  })
})
