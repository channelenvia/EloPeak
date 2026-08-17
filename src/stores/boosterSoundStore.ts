import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { OrderSoundId } from '@/features/booster/hooks/orderSoundLibrary'

interface BoosterSoundState {
  soundId: OrderSoundId
  volume: number
  muted: boolean
  setSoundId: (soundId: OrderSoundId) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
}

// Preferência de som de "novo pedido" do booster -- persistida em
// localStorage (mesmo padrão de eloboost-order-builder) pra sobreviver a
// fechar a aba. Lido tanto pelo alerta em si (useNewOrderSound) quanto pelo
// popover de configuração na página de Jobs -- um único lugar guarda a
// escolha, sem prop drilling entre os dois.
export const useBoosterSoundStore = create<BoosterSoundState>()(
  persist(
    (set) => ({
      soundId: 'coin',
      volume: 0.7,
      muted: false,
      setSoundId: (soundId) => set({ soundId }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
      setMuted: (muted) => set({ muted }),
      toggleMuted: () => set((state) => ({ muted: !state.muted })),
    }),
    {
      name: 'eloboost-booster-sound-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
