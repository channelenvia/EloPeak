import { describe, it, expect, beforeEach } from 'vitest'
import { useOrderBuilderStore } from './orderBuilderStore'

describe('orderBuilderStore — MD5 quantity ceiling', () => {
  beforeEach(() => useOrderBuilderStore.getState().reset())

  it('detecting 3 remaining placements selects 3 and blocks 4/5', () => {
    const { setIsMd5, setMd5MatchesRemainingFromApi, setWinsPurchased } = useOrderBuilderStore.getState()
    setIsMd5(true)
    setMd5MatchesRemainingFromApi(3)
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(3)
    expect(useOrderBuilderStore.getState().md5MatchesRemainingCeiling).toBe(3)

    setWinsPurchased(5)
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(3) // clamped, not 5
  })

  it('common Vitórias (non-MD5) caps at 5, defaults to 5', () => {
    const { setService, setWinsPurchased } = useOrderBuilderStore.getState()
    setService('win_boost', 'win_boost')
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(5)
    setWinsPurchased(9)
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(5)
  })

  it('toggling MD5 off clears the ceiling and re-allows up to 5', () => {
    const { setIsMd5, setMd5MatchesRemainingFromApi, setWinsPurchased } = useOrderBuilderStore.getState()
    setIsMd5(true)
    setMd5MatchesRemainingFromApi(2)
    setIsMd5(false)
    expect(useOrderBuilderStore.getState().md5MatchesRemaining).toBeNull()
    setWinsPurchased(5)
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(5)
  })
})

describe('orderBuilderStore — reset limpa dados de identidade do pedido (logout)', () => {
  beforeEach(() => useOrderBuilderStore.getState().reset())

  it('reset apaga Riot ID, notas e seleções — nada de um pedido vaza pro próximo usuário na aba', () => {
    const s = useOrderBuilderStore.getState()
    s.setRiotId('Fulano#BR1')
    s.setNotes('conta com skin rara, cuidado')
    s.setService('win_boost', 'win_boost')
    s.setCurrentRank({ tier: 'gold', division: 'II' })
    s.toggleExtra('extra-abc')
    s.setPreferredBooster('booster-1', 'Booster Um')

    // Sanidade: o estado realmente ficou sujo antes do reset.
    expect(useOrderBuilderStore.getState().riotId).toBe('Fulano#BR1')
    expect(useOrderBuilderStore.getState().selectedExtraIds.size).toBe(1)

    useOrderBuilderStore.getState().reset()

    const after = useOrderBuilderStore.getState()
    expect(after.riotId).toBe('')
    expect(after.customerNotes).toBe('')
    expect(after.currentRank).toBeNull()
    expect(after.serviceType).toBeNull()
    expect(after.selectedExtraIds.size).toBe(0)
    expect(after.preferredBoosterId).toBeNull()
    expect(after.preferredBoosterName).toBeNull()
    expect(after.step).toBe('service')
  })
})

describe('orderBuilderStore — verificação Riot por conta/fila (trava do form + anti-fraude)', () => {
  beforeEach(() => useOrderBuilderStore.getState().reset())

  it('editar o Riot ID invalida a verificação anterior (form volta a travar)', () => {
    const s = useOrderBuilderStore.getState()
    s.setRiotVerified(true)
    s.setMd5Blocked(true)
    s.setRiotAutoFilled(true)
    expect(useOrderBuilderStore.getState().riotVerified).toBe(true)

    s.setRiotId('OutraConta#BR1')
    const after = useOrderBuilderStore.getState()
    expect(after.riotVerified).toBe(false)
    expect(after.md5Blocked).toBe(false)
    expect(after.riotAutoFilled).toBe(false)
  })

  it('clearRiotLookup zera rank/LP/PDL e flags — dados da conta A não vazam pra conta B', () => {
    const s = useOrderBuilderStore.getState()
    s.setCurrentRank({ tier: 'gold', division: 'II' })
    s.setCurrentLp(80)
    s.setRiotVerified(true)
    s.setRiotAutoFilled(true)
    s.setMd5Blocked(true)

    useOrderBuilderStore.getState().clearRiotLookup()
    const after = useOrderBuilderStore.getState()
    expect(after.currentRank).toBeNull()
    expect(after.currentLp).toBe(0)
    expect(after.riotVerified).toBe(false)
    expect(after.riotAutoFilled).toBe(false)
    expect(after.md5Blocked).toBe(false)
    expect(after.md5MatchesRemaining).toBeNull()
  })

  it('trocar de fila invalida a verificação (rank/MD5 são por fila)', () => {
    const s = useOrderBuilderStore.getState()
    s.setCurrentRank({ tier: 'diamond', division: 'I' })
    s.setRiotVerified(true)

    s.setQueueType('flex')
    const after = useOrderBuilderStore.getState()
    expect(after.queueType).toBe('flex')
    expect(after.currentRank).toBeNull()
    expect(after.riotVerified).toBe(false)
  })

  it('setServiceId resolve o uuid SEM apagar as partidas de MD5 detectadas', () => {
    const s = useOrderBuilderStore.getState()
    s.setIsMd5(true)
    s.setMd5MatchesRemainingFromApi(3)
    expect(useOrderBuilderStore.getState().winsPurchased).toBe(3)
    expect(useOrderBuilderStore.getState().md5MatchesRemaining).toBe(3)

    // Resolução slug->uuid (o que OrderBuilder faz) não pode resetar o MD5.
    s.setServiceId('real-md5-uuid')
    const after = useOrderBuilderStore.getState()
    expect(after.serviceId).toBe('real-md5-uuid')
    expect(after.md5MatchesRemaining).toBe(3)
    expect(after.winsPurchased).toBe(3)
    expect(after.isMd5).toBe(true)
  })
})

describe('orderBuilderStore — troca de modalidade limpa addons incompatíveis (por fluxo)', () => {
  beforeEach(() => useOrderBuilderStore.getState().reset())

  it('Elo Boost: solo -> duo com rank definido limpa os addons selecionados', () => {
    const s = useOrderBuilderStore.getState()
    s.setService('elo_boost', 'elo_boost')
    s.setCurrentRank({ tier: 'gold', division: 'II' })
    s.toggleExtra('extra-solo')
    expect(useOrderBuilderStore.getState().selectedExtraIds.size).toBe(1)

    s.setBoostMode('duo')
    expect(useOrderBuilderStore.getState().selectedExtraIds.size).toBe(0)
  })

  it('Clash: solo -> duo limpa os addons selecionados mesmo sem currentRank (Clash nunca seta rank)', () => {
    const s = useOrderBuilderStore.getState()
    s.setService('clash', 'clash')
    expect(useOrderBuilderStore.getState().currentRank).toBeNull()
    s.toggleExtra('extra-clash-solo')
    expect(useOrderBuilderStore.getState().selectedExtraIds.size).toBe(1)

    s.setBoostMode('duo')
    expect(useOrderBuilderStore.getState().selectedExtraIds.size).toBe(0)
  })
})
