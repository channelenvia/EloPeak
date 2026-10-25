// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryErrorNotice } from './QueryErrorNotice'

describe('QueryErrorNotice', () => {
  it('nao renderiza nada quando a consulta esta ok', () => {
    const { container } = render(<QueryErrorNotice isError={false} error={null} onRetry={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra a mensagem do erro e refaz a consulta ao clicar em tentar de novo', async () => {
    const onRetry = vi.fn()
    render(<QueryErrorNotice isError error={new Error('permission denied')} onRetry={onRetry} />)
    expect(screen.getByText('permission denied')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
