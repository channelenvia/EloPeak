// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Card } from './Card'

describe('Card interativo', () => {
  it('é focável por teclado e ativa com Enter e Espaço quando tem onClick', async () => {
    const onClick = vi.fn()
    render(<Card variant="interactive" onClick={onClick} data-testid="card">conteúdo</Card>)
    const card = screen.getByTestId('card')

    await userEvent.tab()
    expect(card).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('não vira alvo de teclado sem onClick', () => {
    render(<Card variant="interactive" data-testid="card">conteúdo</Card>)
    expect(screen.getByTestId('card')).not.toHaveAttribute('tabindex')
  })

  it('não rouba Enter de botões internos', async () => {
    const onCard = vi.fn()
    const onInner = vi.fn()
    render(<Card variant="interactive" onClick={onCard}><button type="button" onClick={onInner}>ok</button></Card>)

    await userEvent.tab() // foca o card
    await userEvent.tab() // foca o botão interno
    await userEvent.keyboard('{Enter}')

    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onCard).toHaveBeenCalledTimes(1) // o clique do botão borbulha como antes; a tecla não dispara o card em dobro
  })
})
