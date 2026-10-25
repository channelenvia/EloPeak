import type { OrderBuilderStep } from '@/stores/orderBuilderStore'
import { isValidRiotId } from '@/lib/boostDomain'
import type { ServiceType, Rank } from '@/types'

export interface StepCompletionState {
  serviceType: ServiceType | null
  selectedCoachPackage: { id: string } | null
  currentRank: Rank | null
  targetRank: Rank | null
  winsPurchased: number | null
  riotId: string
  isMd5: boolean
  riotVerified: boolean
  riotLookupLoading: boolean
  md5MatchesRemaining: number | null
  clashTier: string | null
  clashDay: string | null
  customerLanes: string[]
}

function isWinsPurchasedValid(state: StepCompletionState): boolean {
  const wins = state.winsPurchased
  if (!wins || wins < 1 || wins > 5) return false
  return !state.isMd5 || state.md5MatchesRemaining == null || wins <= state.md5MatchesRemaining
}

function isConfigureComplete(state: StepCompletionState): boolean {
  // Eloboost e Vitórias/MD5 só avançam depois de uma verificação de conta
  // bem-sucedida na fila atual (mesma trava que esconde os campos).
  // Rota é opcional nos 3 modos que usam LaneSelectField (elo_boost,
  // win_boost/md5, clash) -- coaching não tem esse conceito.
  const riotOk = state.riotVerified && isValidRiotId(state.riotId)
  switch (state.serviceType) {
    case 'elo_boost':
      return riotOk && !!state.currentRank && !!state.targetRank
    case 'win_boost':
    case 'md5':
      return riotOk && !!state.currentRank && isWinsPurchasedValid(state)
    case 'coaching':
      return !!state.selectedCoachPackage
    case 'clash':
      // Riot ID obrigatório nos dois modos de Clash; o tier é sempre derivado
      // da verificação Riot e não pode ser escolhido manualmente.
      return riotOk && !!state.clashTier && !!state.clashDay
    default:
      return true
  }
}

// Regras de "step completo" usadas só para gatear o botão Continuar — a
// validação que realmente importa (preço, elegibilidade, etc.) continua
// sendo feita no backend ao criar o pedido. Isto é só UX.
export function isStepComplete(step: OrderBuilderStep, state: StepCompletionState): boolean {
  if (state.riotLookupLoading) return false
  if (step === 'service') return !!state.serviceType
  if (step === 'configure') return isConfigureComplete(state)
  return true
}
