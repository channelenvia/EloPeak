// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRiotLookup } from './useRiotLookup'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'

vi.mock('@/lib/invokeEdgeFunction', () => ({ invokeEdgeFunction: vi.fn() }))
const invoke = vi.mocked(invokeEdgeFunction)

function setup(serviceType: 'elo_boost' | 'win_boost') {
  useOrderBuilderStore.getState().reset()
  useOrderBuilderStore.getState().setService(serviceType, serviceType)
  useOrderBuilderStore.getState().setRiotId('Fulano#BR1')
  return renderHook(() => useRiotLookup())
}

describe('fallback de elo manual (useRiotLookup)', () => {
  beforeEach(() => invoke.mockReset())

  it('Elo Boost sem rank na fila oferece a opcao manual (alem da migracao para MD5)', async () => {
    invoke.mockResolvedValue({ found: true, ranked: false, md5_eligible: true, matches_remaining: 3 })
    const { result } = setup('elo_boost')
    await act(async () => { await result.current.lookupRiotRank() })
    expect(result.current.manualRankOffer).toBe(true)
    expect(result.current.unrankedOffer).toEqual({ matchesRemaining: 3 })
    expect(useOrderBuilderStore.getState().riotVerified).toBe(false)
  })

  it('Elo Boost sem rank e sem posicionamento restante: nao e mais beco sem saida, oferece o elo manual', async () => {
    invoke.mockResolvedValue({ found: true, ranked: false, md5_eligible: true, matches_remaining: 0 })
    const { result } = setup('elo_boost')
    await act(async () => { await result.current.lookupRiotRank() })
    expect(result.current.manualRankOffer).toBe(true)
    expect(result.current.unrankedOffer).toBeNull()
    expect(result.current.riotLookupError).toBeNull()
  })

  it('declareRankManually libera o formulario e marca o elo como declarado', async () => {
    invoke.mockResolvedValue({ found: true, ranked: false, md5_eligible: true, matches_remaining: 0 })
    const { result } = setup('elo_boost')
    await act(async () => { await result.current.lookupRiotRank() })
    act(() => result.current.declareRankManually())
    const state = useOrderBuilderStore.getState()
    expect(state.rankDeclared).toBe(true)
    expect(state.riotVerified).toBe(true)
    expect(state.riotAutoFilled).toBe(false)
    expect(result.current.manualRankOffer).toBe(false)
  })

  it('Vitorias com rank na Riot nao declara nada (origem riot)', async () => {
    invoke.mockResolvedValue({ found: true, ranked: true, tier: 'gold', division: 'II', league_points: 40, md5_eligible: false })
    const { result } = setup('win_boost')
    await act(async () => { await result.current.lookupForWinBoost() })
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(false)
    expect(result.current.manualRankOffer).toBe(false)
  })

  it('MD5 (elo da temporada passada) marca o elo como declarado automaticamente', async () => {
    invoke.mockResolvedValue({ found: true, ranked: false, md5_eligible: true, matches_remaining: 4 })
    const { result } = setup('win_boost')
    await act(async () => { await result.current.lookupForWinBoost() })
    expect(useOrderBuilderStore.getState().rankDeclared).toBe(true)
    expect(useOrderBuilderStore.getState().isMd5).toBe(true)
  })

  it('Vitorias sem rank e sem posicionamento restante oferece o elo manual', async () => {
    invoke.mockResolvedValue({ found: true, ranked: false, md5_eligible: true, matches_remaining: 0 })
    const { result } = setup('win_boost')
    await act(async () => { await result.current.lookupForWinBoost() })
    expect(result.current.manualRankOffer).toBe(true)
    expect(useOrderBuilderStore.getState().isMd5).toBe(false)
  })
})
