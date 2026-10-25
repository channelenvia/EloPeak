// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('./mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mutations')>()),
  acceptBoostOrder: vi.fn().mockResolvedValue({ success: true }),
  confirmOrderCompletion: vi.fn().mockResolvedValue({ success: true }),
}))

import { useAcceptBoostOrder, useConfirmOrderCompletion } from './hooks'

function setup() {
  const queryClient = new QueryClient()
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidated = () => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
  return { wrapper, invalidated }
}

describe('invalidacao de cache apos acoes sobre o pedido (M-35)', () => {
  it('aceitar um job atualiza detalhe, listas, abas com contadores, pedidos ativos e vagas', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useAcceptBoostOrder(), { wrapper })
    await act(() => result.current.mutateAsync({ orderId: 'o1', boosterId: 'b1', challengeId: 'c1' }))
    expect(invalidated()).toEqual(expect.arrayContaining([
      JSON.stringify(['orders', 'detail', 'o1']),
      JSON.stringify(['orders', 'booster']),
      JSON.stringify(['orders', 'booster-tab-counts']),
      JSON.stringify(['orders', 'booster-active']),
      JSON.stringify(['orders', 'available-jobs']),
      JSON.stringify(['boosters', 'slots']),
    ]))
  })

  it('confirmar conclusao tambem atualiza as listas do cliente e os contadores', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useConfirmOrderCompletion('o1'), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(invalidated()).toEqual(expect.arrayContaining([
      JSON.stringify(['orders', 'customer']),
      JSON.stringify(['orders', 'customer-tab-counts']),
    ]))
  })
})
