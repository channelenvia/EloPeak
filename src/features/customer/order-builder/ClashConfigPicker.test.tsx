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

  it('inicia em Solo Clash e esconde tier e dia antes da verificação', () => {
    renderPicker()
    const state = useOrderBuilderStore.getState()
    expect(state.boostMode).toBe('solo')
    expect(state.clashTier).toBeNull()
    expect(state.clashDay).toBeNull()
    expect(state.basePrice).toBe(0)
    expect(screen.queryByText(/^Tier/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Domingo' })).not.toBeInTheDocument()
  })

  it('verifica o Riot ID, preenche o tier e libera a escolha do dia', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByPlaceholderText('NomeDoInvocador#TAG'), 'Fulano#BR1')
    await user.click(screen.getByRole('button', { name: 'Verificar elo' }))

    expect(await screen.findByText('Tier preenchido automaticamente a partir do seu rank atual.')).toBeInTheDocument()
    expect(useOrderBuilderStore.getState().clashTier).toBe('tier_3')
    expect(useOrderBuilderStore.getState().estimatedHours).toBe(4)
    expect(useOrderBuilderStore.getState().pdlModifierPct).toBeNull()
    expect(screen.getByRole('button', { name: 'Domingo' })).toBeInTheDocument()
  })

  it('depois da verificação, o usuário escolhe o dia', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByPlaceholderText('NomeDoInvocador#TAG'), 'Fulano#BR1')
    await user.click(screen.getByRole('button', { name: 'Verificar elo' }))
    await screen.findByRole('button', { name: 'Domingo' })
    await user.click(screen.getByRole('button', { name: 'Domingo' }))
    expect(useOrderBuilderStore.getState().clashDay).toBe('sunday')
  })

  it('com stepAttempted, não exibe erros de campos ainda bloqueados', () => {
    useOrderBuilderStore.getState().reset()
    useOrderBuilderStore.getState().setService('clash', 'clash')
    useOrderBuilderStore.getState().setStepAttempted(true)
    render(<ClashConfigPicker />)

    expect(screen.queryByText('Selecione um tier')).not.toBeInTheDocument()
    expect(screen.queryByText('Selecione um dia')).not.toBeInTheDocument()
  })

  it('editar o Riot ID depois da verificação esconde tier e dia novamente', async () => {
    const user = userEvent.setup()
    renderPicker()

    const riotIdInput = screen.getByPlaceholderText('NomeDoInvocador#TAG')
    await user.type(riotIdInput, 'Fulano#BR1')
    await user.click(screen.getByRole('button', { name: 'Verificar elo' }))
    await screen.findByRole('button', { name: 'Domingo' })
    await user.type(riotIdInput, '2')

    expect(useOrderBuilderStore.getState().riotVerified).toBe(false)
    expect(useOrderBuilderStore.getState().clashTier).toBeNull()
    expect(screen.queryByRole('button', { name: 'Domingo' })).not.toBeInTheDocument()
  })
})
