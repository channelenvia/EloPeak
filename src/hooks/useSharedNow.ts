import { useSyncExternalStore } from 'react'

// Relogio compartilhado: um unico setInterval para todos os componentes que dependem de "agora"
// (prazo, atraso), em vez de um timer por card.
const TICK_MS = 30_000
const listeners = new Set<() => void>()
let timerId: number | null = null
let snapshot = Date.now()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timerId === null) {
    timerId = window.setInterval(() => {
      snapshot = Date.now()
      listeners.forEach((l) => l())
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timerId !== null) {
      window.clearInterval(timerId)
      timerId = null
    }
  }
}

export function useSharedNow(): number {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}
