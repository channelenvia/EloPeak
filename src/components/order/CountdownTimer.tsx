import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

interface CountdownTimerProps {
  /** Início real do boost (orders.match_sync_started_at) — nunca created_at,
   * que só marca o checkout. Sem isso ainda não há prazo a contar. */
  startedAt: string | null
  /** orders.estimated_hours — já vem multiplicado no backend
   * (DELIVERY_ESTIMATE_MULTIPLIER em shared/pricing.ts). */
  estimatedHours: number | null
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function CountdownTimer({ startedAt, estimatedHours }: CountdownTimerProps) {
  const now = useNow(30_000)
  if (!startedAt || estimatedHours == null) return null

  const deadline = new Date(startedAt).getTime() + estimatedHours * 60 * 60 * 1000
  const remainingMs = deadline - now
  // Prazo estourado já vira "Atrasado" no OrderStatusBadge -- repetir o
  // aviso aqui também seria redundante.
  if (remainingMs <= 0) return null

  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))

  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold bg-bg-elevated text-ink-secondary">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>
        {days > 0 && `${days}d `}{hours}h {minutes}min restantes
      </span>
    </div>
  )
}
