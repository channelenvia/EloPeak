import { useContext, useEffect, useRef, type RefObject } from 'react'
import { SceneContext } from './sceneContext'
import type { SceneEngine, SceneFn } from './sceneEngine'

export function useSceneEngine(): SceneEngine {
  const engine = useContext(SceneContext)
  if (!engine) throw new Error('useSceneEngine precisa estar dentro de <SceneProvider>')
  return engine
}

/** Registra uma cena no laço único; a função pode mudar a cada render sem re-registrar. */
export function useScene(scene: SceneFn): void {
  const engine = useSceneEngine()
  const latest = useRef(scene)
  useEffect(() => { latest.current = scene })
  useEffect(() => {
    if (engine.still) return
    return engine.register((t) => latest.current(t))
  }, [engine])
}

interface PinnedOptions {
  /** Distância do topo em que o stage gruda (altura do header sticky). */
  stick?: number
  /** Progresso aplicado uma vez quando o usuário pediu menos movimento. */
  stillProgress: number
}

/** Cena presa à rolagem: `apply(p, t)` roda a cada quadro enquanto a seção está perto. */
export function usePinnedScene(
  sectionRef: RefObject<HTMLElement | null>,
  apply: (progress: number, time: number) => void,
  { stick = 0, stillProgress }: PinnedOptions,
): void {
  const engine = useSceneEngine()
  const latest = useRef(apply)
  useEffect(() => { latest.current = apply })
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    if (engine.still) {
      latest.current(stillProgress, 0)
      return
    }
    return engine.register((t) => {
      if (engine.near(el)) latest.current(engine.pinned(el, stick), t)
    })
  }, [engine, sectionRef, stick, stillProgress])
}
