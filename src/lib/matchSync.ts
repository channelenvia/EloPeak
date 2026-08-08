import type { Order } from '@/types'

export const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000

const SYNCABLE_STATUSES: Order['status'][] = ['in_progress', 'paused', 'drop_requested']

// Pura -- decide só a partir do status e do último sync, sem tocar rede/
// timers, pra ser testável sem montar o componente inteiro. `nowEpochMs`
// injetado (não Date.now() interno) pelo mesmo motivo.
export function shouldAutoSync(
  order: Pick<Order, 'status' | 'last_match_synced_at'>,
  nowEpochMs: number,
): boolean {
  if (!SYNCABLE_STATUSES.includes(order.status)) return false
  const lastSync = order.last_match_synced_at ? new Date(order.last_match_synced_at).getTime() : 0
  return nowEpochMs - lastSync >= AUTO_SYNC_INTERVAL_MS
}
