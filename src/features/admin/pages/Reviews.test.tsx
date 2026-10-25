// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminReviewsPage } from './Reviews'

const REVIEWS = [
  { id: 'r1', order_id: '11111111-aaaa', booster_id: 'b1', rating: 1, content: 'texto ofensivo', is_public: true, is_moderated: false, admin_note: null, created_at: '2026-10-01T10:00:00Z' },
  { id: 'r2', order_id: '22222222-bbbb', booster_id: 'b1', rating: 5, content: 'otimo', is_public: false, is_moderated: true, admin_note: 'duplicada', created_at: '2026-10-02T10:00:00Z' },
]

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/api/reviews', () => ({
  useAdminReviews: () => ({ data: REVIEWS, isLoading: false, isError: false, error: null }),
  useModerateReview: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

describe('AdminReviewsPage', () => {
  it('lista as avaliacoes com o estado publico/oculto e a nota do admin', () => {
    render(<AdminReviewsPage />)
    expect(screen.getByText('texto ofensivo')).toBeInTheDocument()
    expect(screen.getByText('Pública')).toBeInTheDocument()
    expect(screen.getByText('Oculta')).toBeInTheDocument()
    expect(screen.getByText(/Nota do admin: duplicada/)).toBeInTheDocument()
  })

  it('ocultar pede o motivo antes de confirmar', async () => {
    const user = userEvent.setup()
    render(<AdminReviewsPage />)
    await user.click(screen.getByRole('button', { name: /Ocultar/ }))
    expect(await screen.findByText('Ocultar avaliação')).toBeInTheDocument()
    expect(screen.getByLabelText(/Motivo/)).toBeInTheDocument()
  })
})
