import { useEffect, useState } from 'react'

// Um unico relogio local alimenta todos os cards. O servidor continua sendo a
// fonte da data de liberacao; aqui apenas atualizamos o texto a cada segundo.
export function usePendingReviewNow() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return now
}

export function pendingReviewTimeLeft(releaseAt: string | null, now: number): string {
  if (!releaseAt) return '--'
  const diffMs = new Date(releaseAt).getTime() - now
  if (diffMs <= 0) return 'liberando...'
  return `${Math.ceil(diffMs / 1000)}s`
}
