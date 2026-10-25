// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnimatedNumber } from './AnimatedNumber'

function stubReducedMotion(matches: boolean) {
  // jsdom não tem IntersectionObserver (useInView).
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
}

afterEach(() => vi.unstubAllGlobals())

describe('AnimatedNumber', () => {
  it('com reduced-motion mostra o valor final formatado na hora', () => {
    stubReducedMotion(true)
    render(<AnimatedNumber value={1800} />)
    expect(screen.getByText('1.800')).toBeInTheDocument()
  })

  it('usa o format recebido (ex.: moeda)', () => {
    stubReducedMotion(true)
    render(<AnimatedNumber value={12.5} format={(n) => `R$ ${n.toFixed(2)}`} />)
    expect(screen.getByText('R$ 12.50')).toBeInTheDocument()
  })
})
