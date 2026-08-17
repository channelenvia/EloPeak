import type { ServiceType } from '@/types'
import { localDateParts } from './timezone'

export type CompletionBlockReason = 'no_matches_played' | 'clash_completion_window_closed' | 'objective_not_reached' | 'requires_rank_verification'

export interface CompletionGateOrder {
  service_type: ServiceType
  wins_played: number
  losses_played: number
  wins_purchased: number | null
  match_sync_started_at: string | null
  target_rank: unknown | null
}

const CLASH_TIMEZONE = 'America/Sao_Paulo'
const CLASH_UNLOCK_HOUR = 23

// Calendar day of `matchSyncStartedAt`'s local time zone, rolled forward one
// day if the order already started at/after the unlock hour that day --
// either way, the returned day is the FIRST day on which the window is open,
// and the window stays open every day from then on (no re-lock at midnight).
function clashUnlockDayEpoch(matchSyncStartedAt: string): number {
  const start = localDateParts(new Date(matchSyncStartedAt), CLASH_TIMEZONE)
  const startDayEpoch = Date.UTC(start.y, start.m - 1, start.d)
  return start.h >= CLASH_UNLOCK_HOUR ? startDayEpoch + 86_400_000 : startDayEpoch
}

export function clashCompletionUnlocked(matchSyncStartedAt: string, now: Date): boolean {
  const unlockDayEpoch = clashUnlockDayEpoch(matchSyncStartedAt)
  const current = localDateParts(now, CLASH_TIMEZONE)
  const nowDayEpoch = Date.UTC(current.y, current.m - 1, current.d)
  if (nowDayEpoch > unlockDayEpoch) return true
  if (nowDayEpoch < unlockDayEpoch) return false
  return current.h >= CLASH_UNLOCK_HOUR
}

export function canMarkOrderComplete(
  order: CompletionGateOrder,
  now: Date,
): { allowed: boolean; reason?: CompletionBlockReason } {
  if (order.service_type === 'coaching') return { allowed: true }

  // elo_boost (e qualquer outro tipo que preencha target_rank) só pode ser
  // concluído via verificação real de rank na Riot API (verify-order-rank ->
  // complete_verified_order) -- nunca pelo botão direto "Concluir", que só
  // confere partidas jogadas. Sem essa checagem aqui, o botão aparecia
  // habilitado depois de 1 partida mesmo sem o rank alvo ter sido alcançado
  // (o backend já bloqueia isso -- migration 152 -- mas o botão não devia
  // nem ser oferecido nesse caso).
  if (order.target_rank != null) return { allowed: false, reason: 'requires_rank_verification' }

  if (order.service_type === 'clash') {
    if (!order.match_sync_started_at || !clashCompletionUnlocked(order.match_sync_started_at, now)) {
      return { allowed: false, reason: 'clash_completion_window_closed' }
    }
    return { allowed: true }
  }

  const hasMatchEvidence = order.wins_played + order.losses_played >= 1
  if (!hasMatchEvidence) return { allowed: false, reason: 'no_matches_played' }

  if (order.wins_purchased != null && order.wins_played < order.wins_purchased) {
    return { allowed: false, reason: 'objective_not_reached' }
  }

  return { allowed: true }
}
