// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeclaredRankBanner } from './DeclaredRankBanner'

vi.mock('@/api/orders', () => ({
  getOrderRankAssessment: vi.fn().mockResolvedValue({
    order_id: 'o1', status: 'suspicious', created_at: '2026-10-09T00:00:00Z',
    summary: { declared_low: 'diamond', declared_high: 'diamond', estimated_tier: 'silver', sampled_players: 9, sampled_matches: 3, ranked_games_found: 14, summoner_level: 210, notes: ['Os lobbies indicam ~silver, abaixo do elo declarado.'] },
  }),
}))

function renderBanner(props: Parameters<typeof DeclaredRankBanner>[0]) {
  return render(<QueryClientProvider client={new QueryClient()}><DeclaredRankBanner {...props} /></QueryClientProvider>)
}
const declared = { id: 'o1', rank_source: 'client_declared' as const, service_type: 'win_boost' as const }

describe('DeclaredRankBanner', () => {
  it('nao aparece quando o elo veio da Riot', () => {
    renderBanner({ order: { ...declared, rank_source: 'riot' }, viewer: 'admin' })
    expect(screen.queryByTestId('declared-rank-banner')).not.toBeInTheDocument()
  })

  it('admin ve o aviso especial e a verificacao do sistema', async () => {
    renderBanner({ order: declared, viewer: 'admin' })
    expect(screen.getByText('Elo não encontrado pela API — preenchido pelo cliente')).toBeInTheDocument()
    expect(await screen.findByText(/Suspeito: não bate com o elo declarado/)).toBeInTheDocument()
    expect(screen.getByText(/Partidas ranqueadas encontradas: 14/)).toBeInTheDocument()
  })

  it('booster ve o aviso, mas nao a avaliacao do sistema', () => {
    renderBanner({ order: declared, viewer: 'booster' })
    expect(screen.getByText('Elo não encontrado pela API — preenchido pelo cliente')).toBeInTheDocument()
    expect(screen.queryByTestId('rank-assessment')).not.toBeInTheDocument()
  })

  it('cliente ve uma explicacao amigavel (MD5 cita a temporada passada)', () => {
    renderBanner({ order: { ...declared, service_type: 'md5' }, viewer: 'customer' })
    expect(screen.getByText(/elo da temporada passada/)).toBeInTheDocument()
    expect(screen.queryByText(/Elo não encontrado/)).not.toBeInTheDocument()
  })
})
