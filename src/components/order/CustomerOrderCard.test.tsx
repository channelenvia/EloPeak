// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { CustomerOrderCard } from './CustomerOrderCard'
import type { Order } from '@/types'

const BASE = {
  id: 'abcdef12-0000-4000-8000-000000000000', service_type: 'elo_boost', status: 'in_progress',
  assigned_booster_id: 'b1', drop_count: 1, extras: [{ extra_id: 'e1', name: 'Prioridade', sort_order: 1 }],
  current_rank: { tier: 'gold', division: 'II' }, target_rank: { tier: 'diamond', division: 'IV' },
  wins_purchased: null, wins_played: 0, losses_played: 0, avg_pdl_gain: null, avg_pdl_loss: null,
  riot_id: 'Fulano#BR1', customer_lanes: null, boost_mode: 'solo', queue_type: 'solo_duo',
  total_price: 150, estimated_hours: 30, match_sync_started_at: null, completed_at: null,
  created_at: new Date().toISOString(), booster_service_id: null, admin_review_locked: false,
} as unknown as Order

function renderCard(order: Order) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CustomerOrderCard order={order} currency={(n) => `R$ ${n.toFixed(2)}`} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CustomerOrderCard — tooltip de status por perfil', () => {
  const unpaid = { ...BASE, status: 'awaiting_payment', assigned_booster_id: null } as unknown as Order

  it('cliente é orientado a pagar; admin vê o fato', () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><CustomerOrderCard order={unpaid} currency={(n) => `R$ ${n}`} /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent(/PIX ou cartão/i)
    unmount()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><CustomerOrderCard order={unpaid} viewerRole="admin" currency={(n) => `R$ ${n}`} /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent(/cliente ainda não pagou/i)
  })

  it('o card em hover fica acima dos vizinhos para o tooltip não ser coberto', () => {
    const { container } = renderCard(unpaid)
    expect(container.querySelector('.card')?.className).toContain('hover:z-20')
  })
})

describe('CustomerOrderCard', () => {
  it('mostra código, ranks por extenso, Riot ID rotulado, extra e total', () => {
    renderCard(BASE)
    expect(screen.getByText('#ABCDEF12')).toBeInTheDocument()
    expect(screen.getByText('Dropado')).toBeInTheDocument()
    expect(screen.getByText('Ouro II')).toBeInTheDocument()
    expect(screen.getByText('Diamante IV')).toBeInTheDocument()
    expect(screen.getByText('Riot ID')).toBeInTheDocument()
    expect(screen.getByText('Fulano#BR1')).toBeInTheDocument()
    expect(screen.getByText('Prioridade')).toBeInTheDocument()
    expect(screen.getByText('R$ 150.00')).toBeInTheDocument()
  })

  it('pedido de vitórias mostra o contador jogadas/contratadas', () => {
    renderCard({ ...BASE, service_type: 'win_boost', wins_purchased: 5, wins_played: 2, target_rank: null, riot_id: null } as unknown as Order)
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.queryByText('Riot ID')).not.toBeInTheDocument()
  })
})
