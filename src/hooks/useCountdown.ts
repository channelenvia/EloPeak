import { useEffect, useState } from 'react'

// Contagem regressiva até `expiresAt` (ISO). `remaining` é null enquanto não há prazo.
// `serverOffsetMs` = (agora do servidor - agora do navegador) medido quando o prazo chegou: um relógio local
// adiantado/atrasado nao encurta nem estende o prazo do PIX.
export function useCountdown(expiresAt: string | null, serverOffsetMs = 0) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null)
      return
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(expiresAt).getTime() - (Date.now() + serverOffsetMs)) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt, serverOffsetMs])

  const safeRemaining = remaining ?? 0
  const mm = String(Math.floor(safeRemaining / 60)).padStart(2, '0')
  const ss = String(safeRemaining % 60).padStart(2, '0')
  return { remaining, label: `${mm}:${ss}` }
}
