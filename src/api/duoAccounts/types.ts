import type { Division, RankTier } from '@/types'

export interface BoosterVisibleDuoAccount {
  id: string
  label: string
  riot_id: string | null
  current_rank: { tier: RankTier; division: Division } | null
  is_active: boolean
  reserved_by: string | null
  reserved_order_id: string | null
}

export interface AdminDuoAccount extends BoosterVisibleDuoAccount {
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  has_credentials?: boolean
  reserved_at: string | null
  reserved_by_name: string | null
}

export interface DuoAccountReservationHistoryEntry {
  id: string
  reserved_at: string
  released_at: string | null
  booster_id: string
  booster_name: string | null
  order_id: string | null
  order_service_type: string | null
  order_status: string | null
}

export interface DuoAccountReservationHistory {
  stats: {
    total_reservations: number
    total_seconds: number
    distinct_boosters: number
  }
  history: DuoAccountReservationHistoryEntry[]
}

export interface SaveDuoAccountParams {
  accountId?: string
  riotId?: string
  label: string
  tier: string
  division: string | null
  notes?: string
  isActive: boolean
  login?: string
  password?: string
}
