import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[] = []
vi.mock('@/lib/invokeEdgeFunction', () => ({
  invokeEdgeFunction: vi.fn(async (name: string) => { calls.push(`edge:${name}`); return { synced: true } }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(async (name: string) => { calls.push(`rpc:${name}`); return { data: { success: true }, error: null } }) },
}))

import { adminFlagOrderUnderReview, adminOverrideOrderStatus } from './mutations'
import { resolveDropRequest } from '@/api/admin/mutations'

describe('sync de partidas antes de toda mudanca de status do pedido (M-2)', () => {
  beforeEach(() => { calls.length = 0 })

  it('flagar em analise sincroniza antes do RPC', async () => {
    await adminFlagOrderUnderReview({ orderId: 'o1', reason: 'analise manual do pedido' })
    expect(calls).toEqual(['edge:sync-order-matches', 'rpc:admin_flag_order_under_review'])
  })

  it('override de status sincroniza antes do RPC', async () => {
    await adminOverrideOrderStatus({ orderId: 'o1', newStatus: 'paused', reason: 'motivo valido aqui' })
    expect(calls).toEqual(['edge:sync-order-matches', 'rpc:admin_override_order_status'])
  })

  it('resolver drop sincroniza o pedido da solicitacao antes do RPC', async () => {
    await resolveDropRequest({ requestId: 'r1', orderId: 'o1', approve: true })
    expect(calls).toEqual(['edge:sync-order-matches', 'rpc:resolve_drop_request'])
  })

  it('falha do sync nao bloqueia a acao (best-effort)', async () => {
    const { invokeEdgeFunction } = await import('@/lib/invokeEdgeFunction')
    vi.mocked(invokeEdgeFunction).mockRejectedValueOnce(new Error('Riot fora do ar'))
    await adminFlagOrderUnderReview({ orderId: 'o1', reason: 'analise manual do pedido' })
    expect(calls).toContain('rpc:admin_flag_order_under_review')
  })
})
