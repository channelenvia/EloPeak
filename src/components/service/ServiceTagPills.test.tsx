// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { ServiceTagPills } from './ServiceTagPills'

function renderPills(props: React.ComponentProps<typeof ServiceTagPills>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
      <ServiceTagPills {...props} />
    </QueryClientProvider>,
  )
}

describe('ServiceTagPills — rotas', () => {
  it('as 5 rotas viram uma pill só, com 5 ícones e o texto padrão', () => {
    const { container } = renderPills({ lanes: ['top', 'jungle', 'mid', 'bot', 'support'], compact: true })
    expect(screen.getByText('Todas as rotas')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(5)
    expect(screen.queryByText('Jungle')).not.toBeInTheDocument()
  })

  it('usa o texto customizado (rotas disponíveis para o booster)', () => {
    renderPills({ lanes: ['top', 'jungle', 'mid', 'bot', 'support'], allLabel: 'Todas disponíveis' })
    expect(screen.getByText('Todas disponíveis')).toBeInTheDocument()
  })

  it('rotas parciais continuam como pills individuais', () => {
    renderPills({ lanes: ['top', 'mid'], compact: true })
    expect(screen.getByText('Top')).toBeInTheDocument()
    expect(screen.getByText('Mid')).toBeInTheDocument()
    expect(screen.queryByText('Todas as rotas')).not.toBeInTheDocument()
  })
})
