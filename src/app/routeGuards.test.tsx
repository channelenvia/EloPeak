// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './routeGuards'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/lib/supabase', () => ({ signOut: vi.fn(), supabase: { auth: { signOut: vi.fn() } } }))

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<div>area logada</div>} />
        </Route>
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth — perfil que falha ao carregar (H-6)', () => {
  beforeEach(() => {
    useAuthStore.getState().reset()
    useAuthStore.setState({ isInitialized: true })
  })

  it('mostra retry/sair em vez de loader eterno quando ha sessao e o perfil falhou', () => {
    useAuthStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, profileError: true })
    renderGuard()
    expect(screen.getByText('Não foi possível carregar sua conta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  it('sem erro de perfil continua no loader (nao mostra a tela de erro)', () => {
    useAuthStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, profileError: false })
    renderGuard()
    expect(screen.queryByText('Não foi possível carregar sua conta')).toBeNull()
  })
})
