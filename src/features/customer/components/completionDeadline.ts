import type { OrderStatusHistory } from '@/types'

// RN-02: o pedido conclui sozinho 12 h depois de entrar em awaiting_customer (o servidor decide; aqui so a contagem).
export const AUTO_COMPLETE_HOURS = 12

export function awaitingCustomerSince(history: OrderStatusHistory[] | undefined): Date | null {
  const entries = (history ?? []).filter((h) => h.to_status === 'awaiting_customer')
  if (entries.length === 0) return null
  return new Date(Math.max(...entries.map((h) => new Date(h.created_at).getTime())))
}

export function autoCompleteAt(since: Date): Date {
  return new Date(since.getTime() + AUTO_COMPLETE_HOURS * 3_600_000)
}

// "11 h 20 min" / "45 min" / "menos de 1 min"; null depois do prazo (o cron conclui em ate 10 min).
export function formatTimeLeft(deadline: Date, now: Date): string | null {
  const ms = deadline.getTime() - now.getTime()
  if (ms <= 0) return null
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 1) return 'menos de 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
