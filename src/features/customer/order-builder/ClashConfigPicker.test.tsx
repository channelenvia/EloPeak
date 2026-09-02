// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClashConfigPicker } from './ClashConfigPicker'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { lookupDuoAccountRiotRank } from '@/api/duoAccounts'

vi.mock('@/api/duoAccounts', () => ({
  lookupDuoAccountRiotRank: vi.fn(),
}))

const lookupRiotRankMock = vi.mocked(lookupDuoAccountRiotRank)

function renderPicker() {
  useOrderBuilderStore.getState().reset()
  useOrderBuilderStore.getState().setService('clash', 'clash')
  return render(<ClashConfigPicker />)
}

describe('ClashConfigPicker', () => {
  beforeEach(() => {
    useOrderBuilderStore.getState().reset()
    lookupRiotRankMock.mockReset()
    lookupRiotRankMock.mockResolvedValue({
      found: true,
      ranked: true,
      tier: 'gold',
      division: 'II',
      league_points: 50,
    })
  })

  it('inicia em Solo Clash, dia padrão Sábado (embutido no campo Riot ID), tier escondido antes da verificação', () => {
    renderPicker()
    const state = useOrderBuilderStore.getState()
    expect(state.boostMode).toBe('solo')
    expect(state.clashTier).toBeNull()
    // O seletor de dia embutido no campo Riot ID sempre mostra um valor
    // (igual o Tipo de Fila em StepConfigure.tsx) -- por isso já vem
    // preenchido com Sábado por padrão, em vez de ficar null até o clique.
    expect(state.clashDay).toBe('saturday')
    expect(state.basePrice).toBe(0)
    expect(screen.queryByText('Tier')).not.toBeInTheDocument()
    expect(screen.getByText('Sábado')).toBeInTheDocument()
  })

  it('escolhe o dia sem precisar verificar o Riot ID antes', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: 'Trocar dia do Clash' }))
    await user.click(screen.getByRole('button', { name: 'Domingo' }))
    expect(useOrderBuilderStore.getState().clashDay).toBe('sunday')
    expect(useOrderBuilderStore.getState().riotVerified).toBe(false)
  })

  it('verifica o Riot ID e preenche o tier', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByPlaceholderText('NomeDoInvocador#TAG'), 'Fulano#BR1')
    await user.click(screen.getByRole('button', { name: 'Verificar elo' }))

    expect(await screen.findByText('Tier detectado automaticamente pelo seu rank atual.')).toBeInTheDocument()
    expect(useOrderBuilderStore.getState().clashTier).toBe('tier_3')
    expect(useOrderBuilderStore.getState().estimatedHours).toBe(4)
    expect(useOrderBuilderStore.getState().pdlModifierPct).toBeNull()
  })

  it('com stepAttempted, o dia já vem preenchido por padrão (não bloqueia o Riot ID nem exige o tier)', () => {
    useOrderBuilderStore.getState().reset()
    useOrderBuilderStore.getState().setService('clash', 'clash')
    useOrderBuilderStore.getState().setStepAttempted(true)
    render(<ClashConfigPicker />)

    expect(screen.queryByText('Selecione um dia')).not.toBeInTheDocument()
    expect(screen.queryByText('Selecione um tier')).not.toBeInTheDocument()
    expect(useOrderBuilderStore.getState().clashDay).toBe('saturday')
    expect(screen.getByText('Campo obrigatório')).toBeInTheDocument()
  })

  it('editar o Riot ID depois da verificação esconde o tier de novo, mas mantém o dia já escolhido', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: 'Trocar dia do Clash' }))
    await user.click(screen.getByRole('button', { name: 'Domingo' }))
    const riotIdInput = screen.getByPlaceholderText('NomeDoInvocador#TAG')
    await user.type(riotIdInput, 'Fulano#BR1')
    await user.click(screen.getByRole('button', { name: 'Verificar elo' }))
    await screen.findByText('Tier')
    await user.type(riotIdInput, '2')

    expect(useOrderBuilderStore.getState().riotVerified).toBe(false)
    expect(useOrderBuilderStore.getState().clashTier).toBeNull()
    expect(useOrderBuilderStore.getState().clashDay).toBe('sunday')
    expect(screen.queryByText('Tier')).not.toBeInTheDocument()
  })
})
