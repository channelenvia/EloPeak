// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrderStatusBadge } from './Badge'

const PENDING = { status: 'awaiting_payment', assigned_booster_id: null } as const

describe('OrderStatusBadge com tooltip', () => {
  it('mostra a descrição do status como tooltip acessível', () => {
    render(<OrderStatusBadge order={PENDING} viewerRole="customer" />)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent(/aguarda o pagamento/i)
    expect(screen.getByText('Aguardando Pagamento').closest('[aria-describedby]')).toHaveAttribute('aria-describedby', tip.id)
  })

  it('sem ação não é botão; com ação vira botão clicável e mostra a chamada', () => {
    const { rerender } = render(<OrderStatusBadge order={PENDING} viewerRole="customer" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    const onAction = vi.fn()
    rerender(<OrderStatusBadge order={PENDING} viewerRole="customer" onAction={onAction} actionLabel="Clique para pagar" />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Clique para pagar')
    fireEvent.click(screen.getByRole('button'))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('sem perfil nem descrição renderiza só o badge', () => {
    render(<OrderStatusBadge order={PENDING} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByText('Aguardando Pagamento')).toBeInTheDocument()
  })
})
