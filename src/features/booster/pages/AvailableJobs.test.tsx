// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AvailableJobsPage } from './AvailableJobs'
import type { BoosterService, Order } from '@/types'

const coachPackage = {
  id: 'service-1',
  booster_id: 'booster-1',
  title: 'Macro para Solo Queue',
  description: 'Análise completa das decisões da partida.',
  tempo: '1 hora',
  price: 100,
  service_type: 'coaching',
  unit: 'session',
  requirements: null,
  availability_note: null,
  is_active: true,
  rules: null,
  lanes: ['mid'],
  specialties: ['macro'],
  champions: null,
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  deleted_at: null,
} satisfies BoosterService

const coachingJob = {
  id: 'abcdef12-0000-4000-8000-000000000000',
  service_type: 'coaching',
  booster_service_id: coachPackage.id,
  preferred_booster_id: 'booster-1',
  reassigned_by_admin: false,
  exclusive_until: null,
  status: 'awaiting_assignment',
  drop_count: 0,
  rank_source: null,
  current_rank: null,
  target_rank: null,
  wins_purchased: null,
  wins_played: 0,
  losses_played: 0,
  avg_pdl_gain: null,
  avg_pdl_loss: null,
  sessions_purchased: 2,
  riot_id: null,
  customer_lanes: null,
  extras: [],
  total_price: 100,
  created_at: '2026-10-01T12:00:00.000Z',
} as unknown as Order

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ profile: { id: 'booster-1' } }),
}))

vi.mock('@/api/orders', () => ({
  useAvailableJobs: () => ({ data: [coachingJob], isLoading: false }),
  useBoosterSlotInfo: () => ({ data: { solo_count: 0, duo_count: 0, total_count: 0, max_total: 3, is_top3: false, exclusive_slot_used: false, max_exclusive: 1 } }),
  useAcceptBoostOrder: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
}))

vi.mock('@/api/boosters', () => ({
  useOwnBoosterSlotEligibility: () => ({ data: { status: 'approved' } }),
}))

vi.mock('@/api/coaching', () => ({
  useBoosterServicesByIds: () => ({ data: [coachPackage] }),
}))

vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => (value: number) => `R$ ${value.toFixed(2)}`,
}))

vi.mock('@/lib/ddragon', () => ({
  useDdragonVersion: () => null,
  useDdragonChampionIds: () => undefined,
  championIconUrl: () => null,
}))

vi.mock('@/features/booster/components/OrderSoundSettings', () => ({
  OrderSoundSettings: () => null,
}))

describe('AvailableJobsPage', () => {
  it('renderiza os detalhes do pacote de coaching uma única vez dentro do card', () => {
    render(<MemoryRouter><AvailableJobsPage /></MemoryRouter>)

    expect(screen.getAllByText(coachPackage.description!)).toHaveLength(1)
    expect(screen.getAllByText(coachPackage.tempo!)).toHaveLength(1)
    expect(screen.getAllByText('Mid')).toHaveLength(1)
  })
})
