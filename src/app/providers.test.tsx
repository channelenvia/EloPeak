// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

const SESSION = { user: { id: 'u1', user_metadata: {}, app_metadata: {} } }
let authCallback: ((event: string, session: unknown) => void) | null = null
let resolveSession: (value: unknown) => void = () => {}
const fromProfiles = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => new Promise((resolve) => { resolveSession = resolve }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
    from: (table: string) => {
      fromProfiles(table)
      const builder = { select: () => builder, eq: () => builder, maybeSingle: () => Promise.resolve({ data: { id: 'u1', role: 'customer' }, error: null }) }
      return builder
    },
    rpc: vi.fn(),
  },
}))
vi.mock('@/lib/invokeEdgeFunction', () => ({ EdgeFunctionError: class extends Error {}, invokeEdgeFunction: vi.fn() }))

import { Providers } from './providers'
import { useAuthStore } from '@/stores/authStore'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'

describe('AuthProvider — getSession tardio (H-6)', () => {
  beforeEach(() => {
    useAuthStore.getState().reset()
    useAuthStore.setState({ isInitialized: false })
    fromProfiles.mockClear()
  })

  it('TOKEN_REFRESHED antes do getSession nao descarta a sessao: o perfil e carregado', async () => {
    render(<Providers><div /></Providers>)
    await act(async () => { authCallback?.('TOKEN_REFRESHED', SESSION) })
    await act(async () => { resolveSession({ data: { session: SESSION } }) })

    await waitFor(() => expect(useAuthStore.getState().profile?.id).toBe('u1'))
    expect(fromProfiles).toHaveBeenCalledWith('profiles')
  })

  it('SIGNED_IN com outro usuario (sem SIGNED_OUT) limpa perfil e rascunho da conta anterior (M-24)', async () => {
    render(<Providers><div /></Providers>)
    await act(async () => { resolveSession({ data: { session: SESSION } }) })
    await waitFor(() => expect(useAuthStore.getState().profile?.id).toBe('u1'))
    useOrderBuilderStore.getState().setRiotId('Antigo#BR1')

    const other = { user: { id: 'u2', user_metadata: {}, app_metadata: {} } }
    await act(async () => { authCallback?.('SIGNED_IN', other) })

    expect(useOrderBuilderStore.getState().riotId).toBe('')
    expect(useAuthStore.getState().session?.user.id).toBe('u2')
    expect(useAuthStore.getState().profile?.id).not.toBe('u1')
  })
})
