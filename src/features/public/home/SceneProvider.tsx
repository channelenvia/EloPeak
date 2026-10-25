import { useEffect, useState, type ReactNode } from 'react'
import { SceneEngine } from './sceneEngine'
import { SceneContext } from './sceneContext'

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function SceneProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new SceneEngine(prefersReducedMotion()))
  useEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])
  return <SceneContext.Provider value={engine}>{children}</SceneContext.Provider>
}
