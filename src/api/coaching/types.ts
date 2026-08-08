import type { BoosterService } from '@/types'

export type { BoosterService }

export interface CoachBoosterInfo {
  user_id: string
  display_name: string
  rating: number
  is_top3: boolean
}

export interface SaveCoachingPackageParams {
  boosterId: string
  title: string
  description: string
  tempo: string
  price: number
  serviceType: string
  lanes: string[]
  specialties: string[]
}
