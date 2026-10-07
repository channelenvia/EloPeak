// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useAdminRefunds } from '@/api/admin'
import { useAdminCancelManualRefund, useAdminConfirmManualRefund } from '@/api/orders'
import { AdminRefundsPage } from './Refunds'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/api/admin', () => ({
  useAdminRefunds: vi.fn(),
  useAdminReviewCases: () => ({ data: [], isLoading: false }),
  useAdminAdjustBoosterBalance: () => ({ mutate: vi.fn() }),
  useProfileUsername: () => ({ data: null }),
  useProfileUsernames: () => ({ data: new Map() }),
}))
vi.mock('@/api/orders', () => ({
  useOrder: () => ({ data: null, isFetching: false }),
  useAdminCreateManualRefund: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAdminConfirmManualRefund: vi.fn(),
  useAdminCancelManualRefund: vi.fn(),
}))
vi.mock('@/api/payouts', () => ({ useBoosterPayoutTotals: () => ({ data: null }) }))

const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const refund = (over: object) => ({
  id: 'r1', payment_id: 'p1', order_id: ORDER_ID, mp_refund_id: 'manual-x', amount: 100, reason: 'Cliente pediu o dinheiro de volta',
  initiated_by: 'a1', status: 'pending', is_manual: true, created_at: new Date().toISOString(), ...over,
})

const confirmMutate = vi.fn()
const undoMutate = vi.fn()

function renderPage(refunds: object[]) {
  vi.mocked(useAdminRefunds).mockReturnValue({ data: refunds, isLoading: false } as never)
  render(<MemoryRouter><AdminRefundsPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAdminConfirmManualRefund).mockReturnValue({ mutate: confirmMutate, isPending: false, isError: false } as never)
  vi.mocked(useAdminCancelManualRefund).mockReturnValue({ mutate: undoMutate, isPending: false, isError: false } as never)
})

describe('A reembolsar (admin)', () => {
  it('marcação manual pendente mostra "A reembolsar" e só confirma depois do modal', async () => {
    renderPage([refund({})])
    expect(screen.getAllByText('A reembolsar').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /já reembolsei/i }))
    expect(confirmMutate).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: /confirmar reembolso/i }))
    expect(confirmMutate).toHaveBeenCalledWith('r1', expect.anything())
  })

  it('"Desfazer" cancela a marcação pendente', async () => {
    renderPage([refund({})])
    await userEvent.click(screen.getByRole('button', { name: /desfazer/i }))
    expect(undoMutate).toHaveBeenCalledWith('r1')
  })

  it('reembolso concluído continua na lista, sem ações de confirmação', () => {
    renderPage([refund({ status: 'succeeded' })])
    expect(screen.getByText('Reembolsado', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /já reembolsei/i })).not.toBeInTheDocument()
  })

  it('marcação desfeita aparece como "Desfeito", não como falha', () => {
    renderPage([refund({ status: 'failed' })])
    expect(screen.getByText('Desfeito')).toBeInTheDocument()
  })
})
