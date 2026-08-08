import type { BoosterProfile, Rank } from '@/types'

export type { BoosterProfile }

export type BoosterAccessState = 'no_application' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'removed' | 'error'

export interface ProfessionalProfileData {
  display_name: string
  display_name_changed_at: string | null
  bio: string | null
  lanes: string[] | null
  specialties: string[] | null
  peak_rank: Rank | null
  opgg_link: string | null
  available_days: string[] | null
  hours_per_day_min: number | null
  hours_per_day_max: number | null
}

export interface OnboardBoosterParams {
  displayName: string
  bio: string
  peakRank: Rank
  opggLink?: string
  hoursPerDayMin?: number
  hoursPerDayMax?: number
  fullName?: string
  cpf?: string
  availableDays?: string[]
}

export interface UpdateProfessionalProfileParams {
  displayName: string
  bio: string
  lanes: string[]
  specialties: string[]
  peakTier: string
  opggLink: string
  availableDays: string[]
  hoursPerDayMin: number
  hoursPerDayMax: number
}

// Formato real retornado por get_top_boosters (migration 055) -- não é uma
// projeção de booster_profiles, é uma linha agregada de
// booster_performance_segments com o rank/nome/avatar já anexados.
export interface TopBoosterEntry {
  booster_id: string
  /** booster_profiles.id (PK própria) -- não usar pra linkar /boosters/:displayName, que usa display_name. */
  booster_profile_id: string
  display_name: string
  avatar_url: string | null
  current_rank: Rank | null
  segment_service_type: string
  segment_rank_bucket: string
  total_matches: number
  wins: number
  losses: number
  win_rate_pct: number
  average_kda: number | null
  review_count: number
  average_rating: number | null
  performance_score: number
  score_version: string
  updated_at: string
}

export interface BoosterPerformanceSegment {
  /** Presente em listBoostersPerformance (lookup multi-booster); ausente em getBoosterPerformanceByRank (já escopado a um booster). */
  booster_id?: string
  rank_bucket: string
  average_kda: number | null
  adjusted_win_rate: number | null
  total_matches: number
}
