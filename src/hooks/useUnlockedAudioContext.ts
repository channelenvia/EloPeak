import { useEffect } from 'react'

// Singleton em módulo, não por hook: useNewOrderSound e useChatMentionSound
// ficam montados juntos (ex.: BoosterLayout) -- um AudioContext por hook
// duplicava o desbloqueio e mantinha dois contextos vivos à toa.
let sharedAudioContext: AudioContext | null = null

function unlock() {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext()
  if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume()
}

function getSharedAudioContext(): AudioContext | null {
  return sharedAudioContext
}

/**
 * Desbloqueia (uma vez, no primeiro clique/tecla do usuário -- exigência de
 * Chrome/Safari) um AudioContext compartilhado entre todos os hooks de som
 * da aplicação. Retorna um getter em vez do valor direto porque o contexto
 * só existe depois do primeiro gesto -- quem chama lê no momento de tocar o
 * som, não no render.
 */
export function useUnlockedAudioContext(): () => AudioContext | null {
  useEffect(() => {
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  return getSharedAudioContext
}
