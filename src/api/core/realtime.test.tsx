// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const channels: { name: string; status?: (s: string) => void }[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    getChannels: () => [],
    removeChannel: vi.fn().mockResolvedValue('ok'),
    channel: (name: string) => {
      const entry: { name: string; status?: (s: string) => void } = { name }
      channels.push(entry)
      const chain = { on: () => chain, subscribe: (cb: (s: string) => void) => { entry.status = cb; return chain } }
      return chain
    },
  },
}))

import { useRealtimeInvalidate } from './realtime'

function setup() {
  const queryClient = new QueryClient()
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { wrapper, spy }
}

describe('useRealtimeInvalidate', () => {
  beforeEach(() => { channels.length = 0 })

  it('duas instancias com o mesmo nome-base usam canais diferentes (uma nao rouba a outra)', async () => {
    const { wrapper } = setup()
    const opts = { channel: 'notifications-u1', table: 'notifications', queryKeys: [['k']] }
    renderHook(() => { useRealtimeInvalidate(opts); useRealtimeInvalidate(opts) }, { wrapper })
    await waitFor(() => expect(channels).toHaveLength(2))
    expect(new Set(channels.map((c) => c.name)).size).toBe(2)
  })

  it('refaz as consultas ao reconectar, mas nao na primeira conexao', async () => {
    const { wrapper, spy } = setup()
    renderHook(() => useRealtimeInvalidate({ channel: 'x', table: 't', queryKeys: [['k']] }), { wrapper })
    await waitFor(() => expect(channels).toHaveLength(1))
    channels[0].status?.('SUBSCRIBED')
    expect(spy).not.toHaveBeenCalled()
    channels[0].status?.('CHANNEL_ERROR')
    channels[0].status?.('SUBSCRIBED')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
