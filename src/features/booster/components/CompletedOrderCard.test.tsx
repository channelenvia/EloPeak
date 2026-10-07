// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { CompletedOrderCard } from './CompletedOrderCard'
import type { Order } from '@/types'

const order = {
  id: 'abcdef12-0000-4000-8000-000000000000', service_type: 'elo_boost', status: 'in_progress', assigned_booster_id: 'b1',
  drop_count: 0, extras: [], current_rank: { tier: 'gold', division: 'II' }, target_rank: { tier: 'diamond', division: 'IV' },
  wins_purchased: null, wins_played: 0, losses_played: 0, avg_pdl_gain: null, avg_pdl_loss: null, riot_id: 'Fulano#BR1',
  customer_lanes: null, boost_mode: 'solo', queue_type: 'solo_duo', total_price: 100, estimated_hours: 30,
  match_sync_started_at: null, completed_at: null, created_at: new Date().toISOString(), booster_service_id: null,
} as unknown as Order

describe('CompletedOrderCard (booster)', () => {
  it('mostra o status com tooltip na visão do booster, sem ação de cliente', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><CompletedOrderCard order={order} isTop3={false} /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Em Andamento')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Serviço em andamento.')
    expect(screen.queryByText(/clique para/i)).not.toBeInTheDocument()
  })
})
