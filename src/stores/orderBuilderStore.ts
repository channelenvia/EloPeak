import { create } from 'zustand'
import type { GameSlug, ServiceType, QueueType, BoostMode, Rank, ServiceExtra } from '@/types'

export type OrderBuilderStep = 'service' | 'configure' | 'extras' | 'review' | 'payment'

interface SelectedExtra {
  extra: ServiceExtra
  quantity?: number
}

interface OrderBuilderState {
  step: OrderBuilderStep
  steps: OrderBuilderStep[]

  // Selections
  gameSlug: GameSlug | null
  gameId: string | null
  serviceType: ServiceType | null
  serviceId: string | null
  currentRank: Rank | null
  targetRank: Rank | null
  queueType: QueueType
  boostMode: BoostMode
  server: string
  winsPurchased: number | null
  sessionsPurchased: number | null
  customerNotes: string
  selectedExtras: SelectedExtra[]

  // LP (PDL) fields
  currentLp: number
  avgLpGain: number
  avgLpLoss: number
  targetLp: number | null

  // Computed
  basePrice: number
  extrasPrice: number
  estimatedHours: number | null

  // Actions
  setStep: (step: OrderBuilderStep) => void
  nextStep: () => void
  prevStep: () => void
  setGame: (slug: GameSlug, id: string) => void
  setService: (type: ServiceType, id: string) => void
  setCurrentRank: (rank: Rank) => void
  setTargetRank: (rank: Rank | null) => void
  setQueueType: (queue: QueueType) => void
  setBoostMode: (mode: BoostMode) => void
  setServer: (server: string) => void
  setWinsPurchased: (wins: number) => void
  setSessionsPurchased: (sessions: number) => void
  setNotes: (notes: string) => void
  toggleExtra: (extra: ServiceExtra) => void
  setCurrentLp: (lp: number) => void
  setAvgLpGain: (lp: number) => void
  setAvgLpLoss: (lp: number) => void
  setTargetLp: (lp: number | null) => void
  setBasePrice: (price: number) => void
  setExtrasPrice: (price: number) => void
  setEstimatedHours: (hours: number | null) => void
  reset: () => void
}

const INITIAL_STEPS: OrderBuilderStep[] = ['service', 'configure', 'extras', 'review', 'payment']

const initialState = {
  step: 'service' as OrderBuilderStep,
  steps: INITIAL_STEPS,
  gameSlug: 'lol' as GameSlug,
  gameId: 'lol',
  serviceType: null,
  serviceId: null,
  currentRank: null,
  targetRank: null,
  queueType: 'solo_duo' as QueueType,
  boostMode: 'solo' as BoostMode,
  server: 'BR',
  winsPurchased: null,
  sessionsPurchased: null,
  customerNotes: '',
  selectedExtras: [],
  currentLp: 0,
  avgLpGain: 20,
  avgLpLoss: 15,
  targetLp: null,
  basePrice: 0,
  extrasPrice: 0,
  estimatedHours: null,
}

export const useOrderBuilderStore = create<OrderBuilderState>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  nextStep: () => {
    const { step, steps } = get()
    const idx = steps.indexOf(step)
    if (idx < steps.length - 1) set({ step: steps[idx + 1] })
  },

  prevStep: () => {
    const { step, steps } = get()
    const idx = steps.indexOf(step)
    if (idx > 0) set({ step: steps[idx - 1] })
  },

  setGame: (gameSlug, gameId) => set({ gameSlug, gameId }),
  setService: (serviceType, serviceId) => set({ serviceType, serviceId }),
  setCurrentRank: (currentRank) => set({ currentRank }),
  setTargetRank: (targetRank) => set({ targetRank }),
  setQueueType: (queueType) => set({ queueType }),
  setBoostMode: (boostMode) => set({ boostMode }),
  setServer: (server) => set({ server }),
  setWinsPurchased: (winsPurchased) => set({ winsPurchased }),
  setSessionsPurchased: (sessionsPurchased) => set({ sessionsPurchased }),
  setNotes: (customerNotes) => set({ customerNotes }),

  toggleExtra: (extra) =>
    set((state) => {
      const exists = state.selectedExtras.find((e) => e.extra.id === extra.id)
      if (exists) {
        return { selectedExtras: state.selectedExtras.filter((e) => e.extra.id !== extra.id) }
      }
      return { selectedExtras: [...state.selectedExtras, { extra }] }
    }),

  setCurrentLp: (currentLp) => set({ currentLp }),
  setAvgLpGain: (avgLpGain) => set({ avgLpGain }),
  setAvgLpLoss: (avgLpLoss) => set({ avgLpLoss }),
  setTargetLp: (targetLp) => set({ targetLp }),
  setBasePrice: (basePrice) => set({ basePrice }),
  setExtrasPrice: (extrasPrice) => set({ extrasPrice }),
  setEstimatedHours: (estimatedHours) => set({ estimatedHours }),

  reset: () => set(initialState),
}))
